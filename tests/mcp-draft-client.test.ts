import assert from "node:assert/strict";
import { test } from "vitest";

import { LocalStorageDocumentRepository } from "../app/lib/documents/local-storage-repository.ts";
import {
  McpDraftDocumentRepository,
  MemoryDocumentRecoveryStore,
} from "../app/lib/documents/mcp-draft-repository.ts";
import { DocumentConflictError } from "../app/lib/documents/types.ts";
import {
  type DraftSnapshot,
  McpServiceError,
  McpRevisionConflictError,
  MiniCanvasMcpClient,
} from "../app/lib/mcp/mini-canvas-client.ts";
import {
  LocalMcpToolClient,
  type McpToolClient,
  type McpToolResult,
} from "../app/lib/mcp/tool-client.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function draft(content = "# 原文", version = 1): DraftSnapshot {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "tester",
    path: "Notes/Test.md",
    content,
    baseRevision: "1-base",
    isNew: false,
    version,
    status: "active",
    createdAt: 1,
    updatedAt: version,
    expiresAt: 999_999_999_999,
  };
}

class FakeTools implements McpToolClient {
  current = draft();
  readonly calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

  async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<McpToolResult> {
    this.calls.push({ name, arguments: arguments_ });
    if (name === "get_draft") return { structuredContent: this.current };
    if (name === "update_draft") {
      const expectedVersion = arguments_.expectedVersion;
      if (expectedVersion !== this.current.version) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "draft_conflict",
                expectedVersion,
                actualVersion: this.current.version,
              }),
            },
          ],
        };
      }
      this.current = draft(String(arguments_.content), this.current.version + 1);
      return { structuredContent: this.current };
    }
    if (name === "preview_commit") {
      return {
        structuredContent: {
          draftId: this.current.id,
          path: this.current.path,
          version: this.current.version,
          confirmationToken: "p".repeat(43),
          baseRevision: this.current.baseRevision,
          isNew: this.current.isNew,
          changed: true,
          characterDelta: 4,
          lineDelta: 1,
          contentSha256: "a".repeat(64),
        },
      };
    }
    if (name === "commit_draft") {
      const committed: DraftSnapshot = {
        ...this.current,
        status: "committed",
        committedRevision: "2-committed",
      };
      this.current = committed;
      return {
        structuredContent: {
          draft: committed,
          note: {
            path: committed.path,
            content: committed.content,
            revision: "2-committed",
            ctime: 1,
            mtime: 2,
            size: committed.content.length,
            children: [],
            idempotentReplay: false,
          },
        },
      };
    }
    throw new Error(`unexpected tool ${name}`);
  }
}

test("local editor proxy sends a standard MCP tool call envelope", async () => {
  let requestBody: unknown;
  const client = new LocalMcpToolClient(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as unknown;
    return new Response(
      JSON.stringify({ structuredContent: { ok: true } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const result = await client.callTool("get_draft", { draftId: "draft-1" });

  assert.deepEqual(requestBody, {
    name: "get_draft",
    arguments: { draftId: "draft-1" },
  });
  assert.deepEqual(result.structuredContent, { ok: true });
});

test("MCP draft repository autosaves through optimistic draft versions", async () => {
  const tools = new FakeTools();
  const client = new MiniCanvasMcpClient(tools);
  const repository = new McpDraftDocumentRepository({
    client,
    draft: tools.current,
    recovery: new LocalStorageDocumentRepository(new MemoryStorage()),
  });

  const saved = await repository.save(
    {
      id: tools.current.id,
      title: "Test",
      content: "# 修改后\n\n正文",
      version: "1",
      updatedAt: 1,
    },
    { expectedVersion: "1", idempotencyKey: "unused-for-draft-update" },
  );
  assert.equal(saved.version, "2");
  assert.equal(saved.content, "# 修改后\n\n正文");
  assert.equal(tools.calls.at(-1)?.name, "update_draft");

  await assert.rejects(
    repository.save(
      { ...saved, content: "过期写入" },
      { expectedVersion: "1", idempotencyKey: "stale" },
    ),
    DocumentConflictError,
  );
});

test("Widget recovery store keeps a session backup without browser storage", async () => {
  const recovery = new MemoryDocumentRecoveryStore();
  const document = {
    id: "draft-1",
    title: "临时恢复",
    content: "# 尚未提交",
    version: "2",
    updatedAt: 2,
  };

  assert.equal(await recovery.loadRecovery(), null);
  await recovery.backup(document);
  assert.deepEqual(await recovery.loadRecovery(), document);
  await recovery.clearRecovery();
  assert.equal(await recovery.loadRecovery(), null);
});

test("MCP draft repository generates a preview from the saved version", async () => {
  const tools = new FakeTools();
  const client = new MiniCanvasMcpClient(tools);
  const repository = new McpDraftDocumentRepository({
    client,
    draft: tools.current,
    recovery: new LocalStorageDocumentRepository(new MemoryStorage()),
  });

  const preview = await repository.previewCommit("1");

  assert.equal(preview.path, "Notes/Test.md");
  assert.equal(preview.version, 1);
  assert.equal(preview.changed, true);
});

test("MCP draft repository commits the previewed version and becomes committed", async () => {
  const tools = new FakeTools();
  const client = new MiniCanvasMcpClient(tools);
  const repository = new McpDraftDocumentRepository({
    client,
    draft: tools.current,
    recovery: new LocalStorageDocumentRepository(new MemoryStorage()),
  });

  const result = await repository.commit(
    "1",
    "editor-test-idempotency-key-0001",
    "p".repeat(43),
  );

  assert.equal(result.draft.status, "committed");
  assert.equal(result.note.revision, "2-committed");
  assert.equal(repository.draft.status, "committed");
  assert.equal(tools.calls.at(-1)?.name, "commit_draft");
});

test("MCP client exposes a Bridge revision conflict without losing the draft", async () => {
  const tools: McpToolClient = {
    async callTool() {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "revision_conflict",
              expectedRevision: "1-base",
              actualRevision: "2-obsidian",
            }),
          },
        ],
      };
    },
  };
  const client = new MiniCanvasMcpClient(tools);

  await assert.rejects(
    client.commitDraft({
      draftId: draft().id,
      expectedVersion: 1,
      idempotencyKey: "editor-test-idempotency-key-0002",
      confirmationToken: "p".repeat(43),
    }),
    (error: unknown) =>
      error instanceof McpRevisionConflictError &&
      error.expectedRevision === "1-base" &&
      error.actualRevision === "2-obsidian",
  );
});

test("MCP client paginates, filters and sorts Vault notes", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const tools: McpToolClient = {
    async callTool(_name, arguments_) {
      calls.push(arguments_);
      if (!arguments_.cursor) {
        return {
          structuredContent: {
            entries: [
              {
                kind: "note",
                path: "Z/末尾.md",
                mimeType: "text/markdown",
                revision: "1-z",
                ctime: 1,
                mtime: 2,
                size: 20,
              },
              {
                kind: "attachment",
                path: "images/ignored.png",
                mimeType: "image/png",
                revision: "1-image",
                ctime: 1,
                mtime: 2,
                size: 30,
              },
            ],
            nextCursor: "page-2",
          },
        };
      }
      return {
        structuredContent: {
          entries: [
            {
              kind: "note",
              path: "A/开头.md",
              mimeType: "text/markdown",
              revision: "1-a",
              ctime: 1,
              mtime: 1,
              size: 10,
            },
          ],
        },
      };
    },
  };

  const notes = await new MiniCanvasMcpClient(tools).listNotes();

  assert.deepEqual(notes.map((note) => note.path), ["A/开头.md", "Z/末尾.md"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursor, "page-2");
});

test("MCP client rejects a repeated pagination cursor", async () => {
  const tools: McpToolClient = {
    async callTool() {
      return {
        structuredContent: { entries: [], nextCursor: "same-cursor" },
      };
    },
  };

  await assert.rejects(
    new MiniCanvasMcpClient(tools).listNotes(),
    /cursor 重复/u,
  );
});

test("MCP client reports missing structured data and malformed draft fields", async () => {
  const missing = new MiniCanvasMcpClient({
    async callTool() {
      return { content: [{ type: "text", text: "没有结构化数据" }] };
    },
  });
  await assert.rejects(missing.getDraft("draft-1"), /没有返回结构化数据/u);

  const malformed = new MiniCanvasMcpClient({
    async callTool() {
      return { structuredContent: { ...draft(), status: "unknown" } };
    },
  });
  await assert.rejects(malformed.getDraft("draft-1"), /草稿状态无效/u);
});

test("MCP client preserves generic service error codes and plain error text", async () => {
  const coded = new MiniCanvasMcpClient({
    async callTool() {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "bridge_unavailable", detail: "offline" }),
          },
        ],
      };
    },
  });
  await assert.rejects(
    coded.getDraft("draft-1"),
    (error: unknown) =>
      error instanceof McpServiceError && error.code === "bridge_unavailable",
  );

  const plain = new MiniCanvasMcpClient({
    async callTool() {
      return {
        isError: true,
        content: [{ type: "text", text: "Bridge 暂时不可用" }],
      };
    },
  });
  await assert.rejects(plain.getDraft("draft-1"), /Bridge 暂时不可用/u);
});

test("MCP client validates list and commit result field types", async () => {
  const malformedList = new MiniCanvasMcpClient({
    async callTool() {
      return { structuredContent: { entries: "not-an-array" } };
    },
  });
  await assert.rejects(malformedList.listNotes(), /Vault 列表格式无效/u);

  const malformedCommit = new MiniCanvasMcpClient({
    async callTool() {
      return {
        structuredContent: {
          draft: draft(),
          note: {
            path: "Notes/Test.md",
            content: "正文",
            revision: "2-revision",
            mtime: 2,
            size: Number.NaN,
            idempotentReplay: false,
          },
        },
      };
    },
  });
  await assert.rejects(
    malformedCommit.commitDraft({
      draftId: draft().id,
      expectedVersion: 1,
      idempotencyKey: "test-key",
      confirmationToken: "p".repeat(43),
    }),
    /字段 size 格式无效/u,
  );
});

test("MCP client decodes image, text and metadata-only attachment results", async () => {
  const resultFor = (delivery: "image" | "text" | "metadata_only") => {
    const common = {
      path: delivery === "text" ? "Assets/diagram.svg" : "Assets/photo.png",
      mimeType: delivery === "text" ? "image/svg+xml" : "image/png",
      revision: "2-attachment",
      size: 2,
      delivery,
    };
    if (delivery === "image") {
      return {
        structuredContent: common,
        content: [{ type: "image", data: "aGk=", mimeType: "image/png" }],
      };
    }
    if (delivery === "text") {
      return { structuredContent: { ...common, text: "<svg />" } };
    }
    return { structuredContent: common };
  };
  let delivery: "image" | "text" | "metadata_only" = "image";
  const client = new MiniCanvasMcpClient({
    async callTool(name, arguments_) {
      assert.equal(name, "read_attachment");
      assert.equal(arguments_.path, "Assets/item");
      return resultFor(delivery);
    },
  });

  assert.deepEqual(await client.readAttachment("Assets/item"), {
    path: "Assets/photo.png",
    mimeType: "image/png",
    revision: "2-attachment",
    size: 2,
    delivery: "image",
    data: "aGk=",
  });
  delivery = "text";
  assert.equal((await client.readAttachment("Assets/item")).delivery, "text");
  delivery = "metadata_only";
  assert.equal(
    (await client.readAttachment("Assets/item")).delivery,
    "metadata_only",
  );
});

test("MCP client rejects malformed attachment deliveries", async () => {
  const malformedImage = new MiniCanvasMcpClient({
    async callTool() {
      return {
        structuredContent: {
          path: "Assets/photo.png",
          mimeType: "image/png",
          revision: "1-photo",
          size: 3,
          delivery: "image",
        },
        content: [{ type: "image", data: "not base64", mimeType: "image/png" }],
      };
    },
  });
  await assert.rejects(
    malformedImage.readAttachment("Assets/photo.png"),
    /图片附件内容无效/u,
  );

  const emptyImage = new MiniCanvasMcpClient({
    async callTool() {
      return {
        structuredContent: {
          path: "Assets/empty.png",
          mimeType: "image/png",
          revision: "1-empty",
          size: 0,
          delivery: "image",
        },
        content: [{ type: "image", data: "", mimeType: "image/png" }],
      };
    },
  });
  await assert.rejects(
    emptyImage.readAttachment("Assets/empty.png"),
    /图片附件内容无效/u,
  );

  const unknownDelivery = new MiniCanvasMcpClient({
    async callTool() {
      return {
        structuredContent: {
          path: "Assets/photo.png",
          mimeType: "image/png",
          revision: "1-photo",
          size: 3,
          delivery: "stream",
        },
      };
    },
  });
  await assert.rejects(
    unknownDelivery.readAttachment("Assets/photo.png"),
    /交付类型无效/u,
  );
});

test("MCP client delegates optional Widget host capabilities", async () => {
  let subscribed = false;
  let closed = false;
  const tools: McpToolClient = {
    async callTool() {
      return { structuredContent: {} };
    },
    subscribeToolResults() {
      subscribed = true;
      return () => {
        subscribed = false;
      };
    },
    async requestDisplayMode(mode) {
      return mode;
    },
    close() {
      closed = true;
    },
  };
  const client = new MiniCanvasMcpClient(tools);
  const unsubscribe = client.subscribeToolResults(() => undefined);
  assert.equal(subscribed, true);
  unsubscribe();
  assert.equal(subscribed, false);
  assert.equal(await client.requestDisplayMode("fullscreen"), "fullscreen");
  client.close();
  assert.equal(closed, true);

  const unsupported = new MiniCanvasMcpClient({
    async callTool() {
      return { structuredContent: {} };
    },
  });
  unsupported.subscribeToolResults(() => undefined)();
  unsupported.close();
  await assert.rejects(
    unsupported.requestDisplayMode("fullscreen"),
    /不支持切换 Widget 展示模式/u,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { LocalStorageDocumentRepository } from "../app/lib/documents/local-storage-repository.ts";
import { McpDraftDocumentRepository } from "../app/lib/documents/mcp-draft-repository.ts";
import { DocumentConflictError } from "../app/lib/documents/types.ts";
import {
  type DraftSnapshot,
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
          baseRevision: this.current.baseRevision,
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
    }),
    (error: unknown) =>
      error instanceof McpRevisionConflictError &&
      error.expectedRevision === "1-base" &&
      error.actualRevision === "2-obsidian",
  );
});

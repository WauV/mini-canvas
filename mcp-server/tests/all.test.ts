import "./config.test.ts";

import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type {
  AttachmentSnapshot,
  CommitNoteInput,
  CommitNoteResult,
  ListVaultEntriesInput,
  ListVaultEntriesResult,
  NoteSnapshot,
  VaultChangeBatch,
} from "../../livesync-bridge/src/types.ts";
import {
  Authorizer,
  AuthorizationError,
  StaticTokenVerifier,
  principalFromAuth,
} from "../src/auth.ts";
import type { NoteGateway } from "../src/bridge-client.ts";
import { AtRestCrypto } from "../src/crypto.ts";
import { McpDatabase } from "../src/database.ts";
import { DraftConflictError, DraftRepository } from "../src/drafts.ts";
import { createMiniCanvasMcpServer } from "../src/mcp.ts";
import { SearchCoordinator, SearchIndex, tokenizeSearchText } from "../src/search.ts";
import { MiniCanvasService } from "../src/service.ts";
import type { Principal } from "../src/types.ts";
import { MINI_CANVAS_WIDGET_URI } from "../src/widget.ts";

const masterKey = Buffer.alloc(32, 7);

class FakeGateway implements NoteGateway {
  readonly notes = new Map<string, NoteSnapshot>();
  readonly attachments = new Map<string, AttachmentSnapshot>();

  async health(): Promise<boolean> {
    return true;
  }

  async readNote(path: string): Promise<NoteSnapshot> {
    const note = this.notes.get(path);
    if (!note) throw new Error("note missing");
    return { ...note, children: [...note.children] };
  }

  async commitNote(input: CommitNoteInput): Promise<CommitNoteResult> {
    const note = await this.readNote(input.path);
    if (note.revision !== input.expectedRevision) throw new Error("revision conflict");
    const revision = `${Number(note.revision.split("-", 1)[0] || 0) + 1}-fake`;
    const updated: NoteSnapshot = {
      ...note,
      content: input.content,
      revision,
      mtime: Date.now(),
      size: Buffer.byteLength(input.content, "utf8"),
    };
    this.notes.set(input.path, updated);
    return { ...updated, idempotentReplay: false };
  }

  async listEntries(input: ListVaultEntriesInput): Promise<ListVaultEntriesResult> {
    const entries = [...this.notes.values()]
      .filter((note) => !input.prefix || note.path.startsWith(input.prefix))
      .map((note) => ({
        path: note.path,
        kind: "note" as const,
        mimeType: "text/markdown; charset=utf-8",
        revision: note.revision,
        ctime: note.ctime,
        mtime: note.mtime,
        size: note.size,
      }));
    return { entries, baselineSequence: "1-fake" };
  }

  async pollChanges(input: { since: string }): Promise<VaultChangeBatch> {
    return { events: [], nextSequence: input.since, pending: 0 };
  }

  async readAttachment(path: string): Promise<AttachmentSnapshot> {
    const value = this.attachments.get(path);
    if (!value) throw new Error("attachment missing");
    return value;
  }
}

function note(path: string, content: string): NoteSnapshot {
  return {
    path,
    content,
    revision: "1-fake",
    ctime: 1,
    mtime: 2,
    size: Buffer.byteLength(content, "utf8"),
    children: ["chunk"],
  };
}

const principal: Principal = {
  userId: "tester",
  scopes: [
    "notes:read",
    "vault:list",
    "attachments:read",
    "drafts:write",
    "drafts:commit",
    "search:read",
    "search:refresh",
  ],
  allowedPaths: ["Notes", "Assets"],
};

test("static tokens produce a server-side principal and path boundaries are enforced", async () => {
  const verifier = new StaticTokenVerifier([
    { ...principal, token: "a".repeat(32) },
  ]);
  const auth = await verifier.verifyAccessToken("a".repeat(32));
  assert.deepEqual(principalFromAuth(auth), principal);

  const authorizer = new Authorizer();
  assert.equal(authorizer.requirePath(principal, "Notes/Physics.md"), "Notes/Physics.md");
  assert.throws(
    () => authorizer.requirePath(principal, "Notes-private/secret.md"),
    AuthorizationError,
  );
  assert.throws(() => authorizer.requirePath(principal, "../secret.md"));
  await assert.rejects(() => verifier.verifyAccessToken("b".repeat(32)));

  const expiredVerifier = new StaticTokenVerifier([
    {
      ...principal,
      token: "c".repeat(32),
      expiresAt: Math.floor(Date.now() / 1_000) - 1,
    },
  ]);
  await assert.rejects(() => expiredVerifier.verifyAccessToken("c".repeat(32)));
});

test("drafts are encrypted at rest and use optimistic versions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mini-canvas-mcp-"));
  const path = join(directory, "drafts.sqlite");
  try {
    const database = new McpDatabase(path);
    const repository = new DraftRepository(database, new AtRestCrypto(masterKey));
    const original = "绝不能出现在 SQLite 里的草稿明文";
    const draft = repository.create({
      userId: "tester",
      path: "Notes/Secret.md",
      content: original,
      baseRevision: "1-a",
    });
    assert.equal(draft.version, 1);
    assert.equal(repository.get(draft.id, "tester").content, original);
    const updated = repository.update({
      id: draft.id,
      userId: "tester",
      content: `${original}\n第二版`,
      expectedVersion: 1,
    });
    assert.equal(updated.version, 2);
    assert.throws(
      () =>
        repository.update({
          id: draft.id,
          userId: "tester",
          content: "stale",
          expectedVersion: 1,
        }),
      DraftConflictError,
    );
    database.close();
    assert.equal(readFileSync(path).includes(Buffer.from(original, "utf8")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expiring a draft returns the same updated timestamp written to SQLite", () => {
  const database = new McpDatabase(":memory:");
  const repository = new DraftRepository(database, new AtRestCrypto(masterKey));
  const draft = repository.create({
    userId: "tester",
    path: "Notes/Expired.md",
    content: "# Expired",
    baseRevision: "1-expired",
  });
  database.connection
    .prepare("UPDATE drafts SET expires_at = 0, updated_at = 1 WHERE id = ?")
    .run(draft.id);

  const before = Date.now();
  const expired = repository.get(draft.id, "tester");
  const persisted = database.connection
    .prepare("SELECT updated_at FROM drafts WHERE id = ?")
    .get(draft.id) as { updated_at: number };

  assert.equal(expired.status, "expired");
  assert.ok(expired.updatedAt >= before);
  assert.equal(expired.updatedAt, persisted.updated_at);
  database.close();
});

test("expired drafts are marked first and deleted after the recovery window", () => {
  const database = new McpDatabase(":memory:");
  const repository = new DraftRepository(database, new AtRestCrypto(masterKey));
  const draft = repository.create({
    userId: "tester",
    path: "Notes/Cleanup.md",
    content: "# Cleanup",
    baseRevision: "1-cleanup",
  });
  const now = 10_000;
  database.connection
    .prepare("UPDATE drafts SET expires_at = ?, updated_at = 1 WHERE id = ?")
    .run(now, draft.id);
  assert.deepEqual(repository.cleanupExpired(now, 1_000), {
    markedExpired: 1,
    deleted: 0,
  });
  assert.equal(repository.get(draft.id, "tester").status, "expired");

  assert.deepEqual(repository.cleanupExpired(now + 1_001, 1_000), {
    markedExpired: 0,
    deleted: 1,
  });
  assert.throws(() => repository.get(draft.id, "tester"));
  database.close();
});

test("search index supports English and CJK without storing note plaintext", () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const index = new SearchIndex(database, crypto);
  const content = "傅里叶变换 connects time domain and frequency domain";
  index.upsertNote(note("Notes/Fourier.md", content), "generation-1");

  assert.equal(tokenizeSearchText("傅里叶 frequency").has("傅里"), true);
  assert.equal(index.search("傅里叶")[0]?.path, "Notes/Fourier.md");
  assert.equal(index.search("frequency")[0]?.title, "Fourier");
  const rows = database.connection
    .prepare("SELECT term_hash FROM search_terms")
    .all() as Array<{ term_hash: string }>;
  assert.equal(rows.some((row) => row.term_hash === "frequency"), false);
  assert.equal(rows.every((row) => /^[a-f0-9]{64}$/u.test(row.term_hash)), true);
  const documents = database.connection.prepare("SELECT * FROM search_documents").all();
  assert.equal(JSON.stringify(documents).includes(content), false);
  database.close();
});

test("case-insensitive search document IDs remove deleted Windows paths", () => {
  const database = new McpDatabase(":memory:");
  const index = new SearchIndex(database, new AtRestCrypto(masterKey, true));
  index.upsertNote(note("Notes/MixedCase.md", "delete me"), "generation-1");
  index.removePath("notes/mixedcase.md");
  assert.deepEqual(index.search("delete"), []);
  database.close();
});

test("service completes draft preview and commit through the gateway", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gateway = new FakeGateway();
  gateway.notes.set("Notes/Test.md", note("Notes/Test.md", "# Original"));
  const search = new SearchCoordinator(new SearchIndex(database, crypto), gateway);
  const service = new MiniCanvasService({
    gateway,
    drafts: new DraftRepository(database, crypto),
    search,
  });

  const draft = await service.createDraft(principal, { path: "Notes/Test.md" });
  const changed = service.updateDraft(principal, {
    draftId: draft.id,
    content: "# Updated\n\n中文内容",
    expectedVersion: 1,
  });
  const preview = service.previewCommit(principal, {
    draftId: draft.id,
    expectedVersion: changed.version,
  });
  assert.equal(preview.changed, true);
  const committed = await service.commitDraft(principal, {
    draftId: draft.id,
    expectedVersion: changed.version,
    idempotencyKey: "test-idempotency-key-0001",
  });
  assert.equal(committed.draft.status, "committed");
  assert.equal((await gateway.readNote("Notes/Test.md")).content, "# Updated\n\n中文内容");
  database.close();
});

test("MCP exposes the Widget resource, annotated tools and encrypted draft launch", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gateway = new FakeGateway();
  gateway.notes.set("Notes/Test.md", note("Notes/Test.md", "# MCP"));
  const search = new SearchCoordinator(new SearchIndex(database, crypto), gateway);
  const service = new MiniCanvasService({
    gateway,
    drafts: new DraftRepository(database, crypto),
    search,
  });
  const server = createMiniCanvasMcpServer(service, principal);
  const client = new Client({ name: "mini-canvas-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 11);
  assert.equal(tools.tools.every((tool) => tool.annotations?.readOnlyHint !== undefined), true);
  assert.equal(
    tools.tools.every((tool) =>
      (tool._meta?.securitySchemes as Array<{ type: string }> | undefined)?.some(
        (scheme) => scheme.type === "noauth",
      ),
    ),
    true,
  );
  const openTool = tools.tools.find((tool) => tool.name === "open_mini_canvas");
  assert.equal(
    (openTool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri,
    MINI_CANVAS_WIDGET_URI,
  );
  assert.equal(openTool?._meta?.["ui/resourceUri"], MINI_CANVAS_WIDGET_URI);

  const resources = await client.listResources();
  assert.equal(resources.resources.length, 1);
  assert.equal(resources.resources[0]?.uri, MINI_CANVAS_WIDGET_URI);
  assert.equal(resources.resources[0]?.mimeType, "text/html;profile=mcp-app");
  const widget = await client.readResource({ uri: MINI_CANVAS_WIDGET_URI });
  const widgetContent = widget.contents[0];
  assert.equal(widgetContent && "text" in widgetContent, true);
  if (!widgetContent || !("text" in widgetContent)) {
    throw new Error("Widget resource did not return HTML text");
  }
  assert.equal(widgetContent.mimeType, "text/html;profile=mcp-app");
  assert.match(widgetContent.text, /id="mini-canvas-root"/u);
  assert.match(widgetContent.text, /<script type="module">/u);
  assert.doesNotMatch(widgetContent.text, /MINI_CANVAS_MCP_AUTH_JSON/u);

  const pickerResult = await client.callTool({
    name: "open_mini_canvas",
    arguments: {},
  });
  assert.deepEqual(pickerResult.structuredContent, { mode: "picker" });
  const launchResult = await client.callTool({
    name: "open_mini_canvas",
    arguments: { path: "Notes/Test.md" },
  });
  assert.equal(
    (launchResult.structuredContent as { path: string }).path,
    "Notes/Test.md",
  );
  const launchedDraftId = (launchResult.structuredContent as { draftId?: string })
    .draftId;
  assert.equal(typeof launchedDraftId, "string");
  const launchedDraft = await client.callTool({
    name: "get_draft",
    arguments: { draftId: launchedDraftId },
  });
  assert.equal(
    (launchedDraft.structuredContent as { content: string }).content,
    "# MCP",
  );

  const result = await client.callTool({
    name: "create_draft",
    arguments: { path: "Notes/Test.md" },
  });
  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent as { path: string }).path, "Notes/Test.md");
  await client.close();
  await server.close();
  database.close();
});

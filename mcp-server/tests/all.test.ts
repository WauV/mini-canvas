import "./config.test.ts";

import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { gunzipSync } from "node:zlib";

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
import { NEW_NOTE_EXPECTED_REVISION } from "../../livesync-bridge/src/types.ts";
import {
  Authorizer,
  AuthorizationError,
  StaticTokenVerifier,
  principalFromAuth,
} from "../src/auth.ts";
import { BridgeHttpError, type NoteGateway } from "../src/bridge-client.ts";
import { AtRestCrypto } from "../src/crypto.ts";
import { McpDatabase } from "../src/database.ts";
import { DraftConflictError, DraftRepository } from "../src/drafts.ts";
import { createMiniCanvasMcpServer } from "../src/mcp.ts";
import { SearchCoordinator, SearchIndex, tokenizeSearchText } from "../src/search.ts";
import type { McpConfig } from "../src/config.ts";
import type { McpRuntime } from "../src/runtime.ts";
import { startMcpHttpServer } from "../src/server.ts";
import {
  CommitPreviewRequiredError,
  MiniCanvasService,
} from "../src/service.ts";
import type { Principal } from "../src/types.ts";
import { StaticTenantResourceProvider } from "../src/tenant-resources.ts";
import { MINI_CANVAS_WIDGET_URI } from "../src/widget.ts";

const masterKey = Buffer.alloc(32, 7);
const tenantId = "local-vault";

class FakeGateway implements NoteGateway {
  readonly notes = new Map<string, NoteSnapshot>();
  readonly attachments = new Map<string, AttachmentSnapshot>();

  async health(): Promise<boolean> {
    return true;
  }

  async readNote(path: string): Promise<NoteSnapshot> {
    const note = this.notes.get(path);
    if (!note) throw new BridgeHttpError(404, { error: "note_not_found" });
    return { ...note, children: [...note.children] };
  }

  async commitNote(input: CommitNoteInput): Promise<CommitNoteResult> {
    if (input.expectedRevision === NEW_NOTE_EXPECTED_REVISION) {
      if (this.notes.has(input.path)) {
        throw new BridgeHttpError(409, { error: "revision_conflict" });
      }
      const created: NoteSnapshot = {
        path: input.path,
        content: input.content,
        revision: "1-created",
        ctime: Date.now(),
        mtime: Date.now(),
        size: Buffer.byteLength(input.content, "utf8"),
        children: ["created-chunk"],
      };
      this.notes.set(input.path, created);
      return { ...created, idempotentReplay: false };
    }
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
  tenantId,
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

function tenantResources(
  gateway: NoteGateway,
  search: SearchCoordinator,
  id = tenantId,
): StaticTenantResourceProvider {
  return new StaticTenantResourceProvider([[id, { gateway, search }]]);
}

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

test("static tokens cannot bind one bearer credential to multiple identities", () => {
  const token = "d".repeat(32);
  assert.throws(
    () =>
      new StaticTokenVerifier([
        { ...principal, token },
        {
          ...principal,
          token,
          userId: "other-user",
          tenantId: "other-tenant",
        },
      ]),
    /不能重复绑定/u,
  );
});

test("tenant resources reject a search index from another tenant", () => {
  const database = new McpDatabase(":memory:");
  try {
    const gateway = new FakeGateway();
    const search = new SearchCoordinator(
      new SearchIndex(database, new AtRestCrypto(masterKey), "tenant-b"),
      gateway,
    );
    assert.throws(
      () =>
        new StaticTenantResourceProvider([
          ["tenant-a", { gateway, search }],
        ]),
      /租户资源与搜索索引不匹配/u,
    );
  } finally {
    database.close();
  }
});

test("HTTP MCP accepts complete Markdown requests larger than Express' old 100 KB default", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gateway = new FakeGateway();
  const search = new SearchCoordinator(new SearchIndex(database, crypto), gateway);
  const drafts = new DraftRepository(database, crypto);
  const service = new MiniCanvasService({
    drafts,
    resources: tenantResources(gateway, search),
  });
  const token = "h".repeat(32);
  const config: McpConfig = {
    host: "127.0.0.1",
    port: 0,
    allowedHosts: ["127.0.0.1", "localhost", "[::1]"],
    databasePath: ":memory:",
    masterKey,
    tokens: [{ ...principal, token }],
    bridgeUrl: "http://127.0.0.1:27124",
    bridgeToken: "b".repeat(32),
    autoIndex: false,
    caseInsensitivePaths: false,
    draftRetentionDays: 30,
    defaultTenantId: tenantId,
  };
  const runtime = {
    database,
    drafts,
    gateway,
    search,
    service,
    verifier: new StaticTokenVerifier(config.tokens),
  } as unknown as McpRuntime;
  const httpServer = await startMcpHttpServer(config, runtime);
  try {
    const address = httpServer.address() as AddressInfo;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { padding: "x".repeat(150_000) },
    });
    assert.ok(Buffer.byteLength(body, "utf8") > 100_000);
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });
    assert.notEqual(response.status, 413);
    await response.arrayBuffer();
  } finally {
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
    database.close();
  }
});

test("drafts are encrypted at rest and use optimistic versions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mini-canvas-mcp-"));
  const path = join(directory, "drafts.sqlite");
  try {
    const database = new McpDatabase(path);
    const repository = new DraftRepository(database, new AtRestCrypto(masterKey));
    const original = "绝不能出现在 SQLite 里的草稿明文";
    const draft = repository.create({
      tenantId,
      userId: "tester",
      path: "Notes/Secret.md",
      content: original,
      baseRevision: "1-a",
    });
    assert.equal(draft.version, 1);
    assert.equal(repository.get(draft.id, tenantId, "tester").content, original);
    const updated = repository.update({
      id: draft.id,
      tenantId,
      userId: "tester",
      content: `${original}\n第二版`,
      expectedVersion: 1,
    });
    assert.equal(updated.version, 2);
    assert.throws(
      () =>
        repository.update({
          id: draft.id,
          tenantId,
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

test("v1 database migration preserves encrypted drafts and rebuilds derived search", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mini-canvas-mcp-v1-"));
  const path = join(directory, "legacy.sqlite");
  const legacyTenantId = "legacy-vault";
  const crypto = new AtRestCrypto(masterKey);
  const id = "11111111-1111-4111-8111-111111111111";
  const userId = "legacy-user";
  const draftPath = "Notes/Legacy.md";
  const content = "# Legacy encrypted draft";
  const encryptedPath = crypto.encryptDraft(
    draftPath,
    `draft\0${userId}\0${id}\0path`,
  );
  const encryptedBase = crypto.encryptDraft(
    content,
    `draft\0${userId}\0${id}\0base`,
  );
  const encryptedCurrent = crypto.encryptDraft(
    content,
    `draft\0${userId}\0${id}\0current`,
  );
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE drafts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      path_nonce TEXT NOT NULL, path_ciphertext TEXT NOT NULL, path_tag TEXT NOT NULL,
      base_revision TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
      base_nonce TEXT NOT NULL, base_ciphertext TEXT NOT NULL, base_tag TEXT NOT NULL,
      current_nonce TEXT NOT NULL, current_ciphertext TEXT NOT NULL, current_tag TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      committed_revision TEXT
    );
    CREATE TABLE search_documents (
      id TEXT PRIMARY KEY, path_nonce TEXT NOT NULL, path_ciphertext TEXT NOT NULL,
      path_tag TEXT NOT NULL, title_nonce TEXT NOT NULL, title_ciphertext TEXT NOT NULL,
      title_tag TEXT NOT NULL, revision TEXT NOT NULL, mtime INTEGER NOT NULL,
      size INTEGER NOT NULL, generation TEXT NOT NULL
    );
    CREATE TABLE search_terms (
      document_id TEXT NOT NULL REFERENCES search_documents(id) ON DELETE CASCADE,
      term_hash TEXT NOT NULL, frequency INTEGER NOT NULL,
      PRIMARY KEY (document_id, term_hash)
    );
    CREATE TABLE service_state (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  legacy.prepare(`
    INSERT INTO drafts VALUES (
      ?, ?, ?, ?, ?, '1-legacy', 1, 'active',
      ?, ?, ?, ?, ?, ?, 1, 1, 9999999999999, NULL
    )
  `).run(
    id,
    userId,
    encryptedPath.nonce,
    encryptedPath.ciphertext,
    encryptedPath.tag,
    encryptedBase.nonce,
    encryptedBase.ciphertext,
    encryptedBase.tag,
    encryptedCurrent.nonce,
    encryptedCurrent.ciphertext,
    encryptedCurrent.tag,
  );
  legacy.prepare(`
    INSERT INTO search_documents VALUES
      ('legacy-doc', 'n', 'c', 't', 'n', 'c', 't', '1-old', 1, 1, 'old')
  `).run();
  legacy.prepare("INSERT INTO service_state VALUES ('search_sequence', '9-old', 1)").run();
  legacy.close();

  try {
    const database = new McpDatabase(path, legacyTenantId);
    const repository = new DraftRepository(database, crypto);
    assert.equal(
      repository.get(id, legacyTenantId, userId).content,
      content,
    );
    assert.equal(
      (database.connection.prepare("PRAGMA user_version").get() as {
        user_version: number;
      }).user_version,
      2,
    );
    assert.equal(
      (database.connection.prepare("SELECT COUNT(*) AS count FROM search_documents").get() as {
        count: number;
      }).count,
      0,
    );
    assert.equal(new SearchIndex(database, crypto, legacyTenantId).getSequence(), undefined);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expiring a draft returns the same updated timestamp written to SQLite", () => {
  const database = new McpDatabase(":memory:");
  const repository = new DraftRepository(database, new AtRestCrypto(masterKey));
  const draft = repository.create({
    tenantId,
    userId: "tester",
    path: "Notes/Expired.md",
    content: "# Expired",
    baseRevision: "1-expired",
  });
  database.connection
    .prepare("UPDATE drafts SET expires_at = 0, updated_at = 1 WHERE id = ?")
    .run(draft.id);

  const before = Date.now();
  const expired = repository.get(draft.id, tenantId, "tester");
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
    tenantId,
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
  assert.equal(repository.get(draft.id, tenantId, "tester").status, "expired");

  assert.deepEqual(repository.cleanupExpired(now + 1_001, 1_000), {
    markedExpired: 0,
    deleted: 1,
  });
  assert.throws(() => repository.get(draft.id, tenantId, "tester"));
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

test("draft and search storage are isolated by tenant", () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const drafts = new DraftRepository(database, crypto);
  const draft = drafts.create({
    tenantId: "tenant-a",
    userId: "shared-user",
    path: "Notes/Shared.md",
    content: "tenant A draft",
    baseRevision: "1-a",
  });
  assert.equal(
    drafts.get(draft.id, "tenant-a", "shared-user").content,
    "tenant A draft",
  );
  assert.throws(() => drafts.get(draft.id, "tenant-b", "shared-user"));

  const indexA = new SearchIndex(database, crypto, "tenant-a");
  const indexB = new SearchIndex(database, crypto, "tenant-b");
  indexA.upsertNote(note("Notes/Shared.md", "alpha-only"), "a-generation");
  indexB.upsertNote(note("Notes/Shared.md", "beta-only"), "b-generation");
  indexA.setSequence("a-sequence");
  indexB.setSequence("b-sequence");

  const candidateA = indexA.search("alpha-only")[0];
  const candidateB = indexB.search("beta-only")[0];
  assert.ok(candidateA);
  assert.ok(candidateB);
  assert.notEqual(candidateA.id, candidateB.id);
  assert.deepEqual(indexA.search("beta-only"), []);
  assert.deepEqual(indexB.search("alpha-only"), []);
  assert.equal(indexB.getById(candidateA.id), undefined);
  assert.equal(indexA.getSequence(), "a-sequence");
  assert.equal(indexB.getSequence(), "b-sequence");

  indexA.clear();
  assert.equal(indexA.getSequence(), undefined);
  assert.equal(indexB.getSequence(), "b-sequence");
  assert.equal(indexB.search("beta-only").length, 1);
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

test("search does not advance its checkpoint when an upsert cannot be indexed", async () => {
  class TemporarilyUnavailableGateway extends FakeGateway {
    override async readNote(): Promise<NoteSnapshot> {
      throw new BridgeHttpError(503, { error: "bridge_unavailable" });
    }
  }

  const database = new McpDatabase(":memory:");
  const index = new SearchIndex(database, new AtRestCrypto(masterKey));
  index.setSequence("5-before-failure");
  const search = new SearchCoordinator(index, new TemporarilyUnavailableGateway());
  const internal = search as unknown as {
    applyBatch(batch: VaultChangeBatch): Promise<void>;
  };

  await assert.rejects(
    internal.applyBatch({
      events: [
        {
          sequence: "6-after-failure",
          documentId: "Notes/Temporarily unavailable.md",
          operation: "upsert",
          kind: "note",
          path: "Notes/Temporarily unavailable.md",
          revision: "2-change",
          mimeType: "text/markdown; charset=utf-8",
        },
      ],
      nextSequence: "6-after-failure",
      pending: 0,
    }),
    BridgeHttpError,
  );
  assert.equal(index.getSequence(), "5-before-failure");
  database.close();
});

test("service completes draft preview and commit through the gateway", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gateway = new FakeGateway();
  gateway.notes.set("Notes/Test.md", note("Notes/Test.md", "# Original"));
  const search = new SearchCoordinator(new SearchIndex(database, crypto), gateway);
  const service = new MiniCanvasService({
    drafts: new DraftRepository(database, crypto),
    resources: tenantResources(gateway, search),
  });

  const draft = await service.createDraft(principal, { path: "Notes/Test.md" });
  const changed = service.updateDraft(principal, {
    draftId: draft.id,
    content: "# Updated\n\n中文内容",
    expectedVersion: 1,
  });
  await assert.rejects(
    service.commitDraft(principal, {
      draftId: draft.id,
      expectedVersion: changed.version,
      idempotencyKey: "unpreviewed-idempotency-key-0001",
      confirmationToken: "invalid-preview-token".padEnd(43, "x"),
    }),
    CommitPreviewRequiredError,
  );
  const preview = service.previewCommit(principal, {
    draftId: draft.id,
    expectedVersion: changed.version,
  });
  assert.equal(preview.changed, true);
  const committed = await service.commitDraft(principal, {
    draftId: draft.id,
    expectedVersion: changed.version,
    idempotencyKey: "test-idempotency-key-0001",
    confirmationToken: preview.confirmationToken,
  });
  assert.equal(committed.draft.status, "committed");
  assert.equal((await gateway.readNote("Notes/Test.md")).content, "# Updated\n\n中文内容");
  database.close();
});

test("service rejects unknown and cross-tenant draft access before using another Vault", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gatewayA = new FakeGateway();
  const gatewayB = new FakeGateway();
  gatewayA.notes.set("Notes/Tenant.md", note("Notes/Tenant.md", "# A"));
  gatewayB.notes.set("Notes/Tenant.md", note("Notes/Tenant.md", "# B"));
  const searchA = new SearchCoordinator(
    new SearchIndex(database, crypto, "tenant-a"),
    gatewayA,
  );
  const searchB = new SearchCoordinator(
    new SearchIndex(database, crypto, "tenant-b"),
    gatewayB,
  );
  const service = new MiniCanvasService({
    drafts: new DraftRepository(database, crypto),
    resources: new StaticTenantResourceProvider([
      ["tenant-a", { gateway: gatewayA, search: searchA }],
      ["tenant-b", { gateway: gatewayB, search: searchB }],
    ]),
  });
  const principalA = { ...principal, tenantId: "tenant-a" };
  const principalB = { ...principal, tenantId: "tenant-b" };
  const draft = await service.createDraft(principalA, { path: "Notes/Tenant.md" });
  assert.throws(() => service.getDraft(principalB, draft.id));
  await assert.rejects(
    () => service.listEntries({ ...principal, tenantId: "unknown" }, {}),
    AuthorizationError,
  );
  assert.equal((await gatewayA.readNote("Notes/Tenant.md")).content, "# A");
  assert.equal((await gatewayB.readNote("Notes/Tenant.md")).content, "# B");
  database.close();
});

test("service can prefill a visible draft with a complete edit of an existing note", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gateway = new FakeGateway();
  gateway.notes.set("Notes/Edit.md", note("Notes/Edit.md", "# Original\n"));
  const service = new MiniCanvasService({
    drafts: new DraftRepository(database, crypto),
    resources: tenantResources(
      gateway,
      new SearchCoordinator(new SearchIndex(database, crypto), gateway),
    ),
  });

  const draft = await service.createDraft(principal, {
    path: "Notes/Edit.md",
    content: "# Revised\n\nComplete replacement.",
  });
  assert.equal(draft.isNew, false);
  assert.equal(draft.content, "# Revised\n\nComplete replacement.");
  assert.equal((await gateway.readNote("Notes/Edit.md")).content, "# Original\n");
  const preview = service.previewCommit(principal, {
    draftId: draft.id,
    expectedVersion: draft.version,
  });
  assert.equal(preview.changed, true);
  assert.equal(preview.isNew, false);
  database.close();
});

test("service prepares and commits a collision-safe new Markdown note", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gateway = new FakeGateway();
  const search = new SearchCoordinator(new SearchIndex(database, crypto), gateway);
  const service = new MiniCanvasService({
    drafts: new DraftRepository(database, crypto),
    resources: tenantResources(gateway, search),
  });
  const content = "# 二项式定理\n\n$$(a+b)^n=\\sum_{k=0}^{n}\\binom{n}{k}a^{n-k}b^k$$";

  const draft = await service.createDraft(principal, {
    path: "Notes/二项式定理.md",
    createIfMissing: true,
    content,
  });
  assert.equal(draft.isNew, true);
  assert.equal(draft.baseRevision, NEW_NOTE_EXPECTED_REVISION);
  assert.equal(draft.content, content);

  const preview = service.previewCommit(principal, {
    draftId: draft.id,
    expectedVersion: draft.version,
  });
  assert.equal(preview.isNew, true);
  assert.equal(preview.changed, true);

  const committed = await service.commitDraft(principal, {
    draftId: draft.id,
    expectedVersion: draft.version,
    idempotencyKey: "new-note-idempotency-0001",
    confirmationToken: preview.confirmationToken,
  });
  assert.equal(committed.draft.status, "committed");
  assert.equal(committed.note.revision, "1-created");
  assert.equal((await gateway.readNote("Notes/二项式定理.md")).content, content);
  database.close();
});

test("new-note drafts refuse to replace a note that already exists", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gateway = new FakeGateway();
  gateway.notes.set("Notes/Existing.md", note("Notes/Existing.md", "# Keep me"));
  const service = new MiniCanvasService({
    drafts: new DraftRepository(database, crypto),
    resources: tenantResources(
      gateway,
      new SearchCoordinator(new SearchIndex(database, crypto), gateway),
    ),
  });

  await assert.rejects(
    () =>
      service.createDraft(principal, {
        path: "Notes/Existing.md",
        createIfMissing: true,
        content: "# Replace me",
      }),
    /已经存在/u,
  );
  assert.equal((await gateway.readNote("Notes/Existing.md")).content, "# Keep me");
  database.close();
});

test("MCP exposes the Widget resource, annotated tools and encrypted draft launch", async () => {
  const database = new McpDatabase(":memory:");
  const crypto = new AtRestCrypto(masterKey);
  const gateway = new FakeGateway();
  gateway.notes.set("Notes/Test.md", note("Notes/Test.md", "# MCP"));
  const search = new SearchCoordinator(new SearchIndex(database, crypto), gateway);
  const service = new MiniCanvasService({
    drafts: new DraftRepository(database, crypto),
    resources: tenantResources(gateway, search),
  });
  const server = createMiniCanvasMcpServer(service, principal);
  const client = new Client({ name: "mini-canvas-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 15);
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
  const editTool = tools.tools.find(
    (tool) => tool.name === "edit_note_in_mini_canvas",
  );
  const createTool = tools.tools.find(
    (tool) => tool.name === "create_note_in_mini_canvas",
  );
  const reopenTool = tools.tools.find(
    (tool) => tool.name === "open_draft_in_mini_canvas",
  );
  const commitTool = tools.tools.find((tool) => tool.name === "commit_draft");
  assert.equal(
    (openTool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri,
    MINI_CANVAS_WIDGET_URI,
  );
  assert.equal(openTool?._meta?.["ui/resourceUri"], MINI_CANVAS_WIDGET_URI);
  assert.equal(
    (editTool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri,
    MINI_CANVAS_WIDGET_URI,
  );
  assert.match(editTool?.description ?? "", /^Use this when/u);
  assert.match(createTool?.description ?? "", /create a NEW/u);
  assert.deepEqual(createTool?.inputSchema.required?.sort(), ["content", "path"]);
  assert.equal(
    (createTool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri,
    MINI_CANVAS_WIDGET_URI,
  );
  assert.equal(
    (reopenTool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri,
    MINI_CANVAS_WIDGET_URI,
  );
  assert.match(reopenTool?.description ?? "", /draftId/u);
  assert.equal(commitTool?.annotations?.destructiveHint, true);
  assert.equal(commitTool?.annotations?.idempotentHint, true);
  assert.deepEqual(commitTool?.inputSchema.required?.sort(), [
    "confirmationToken",
    "draftId",
    "expectedVersion",
    "idempotencyKey",
  ]);

  const prompts = await client.listPrompts();
  assert.deepEqual(
    prompts.prompts.map((prompt) => prompt.name).sort(),
    [
      "mini_canvas_commands",
      "mini_canvas_create_note",
      "mini_canvas_edit_note",
    ],
  );
  const commandPrompt = await client.getPrompt({
    name: "mini_canvas_commands",
    arguments: {},
  });
  const commandPromptText = commandPrompt.messages[0]?.content;
  assert.equal(commandPromptText?.type, "text");
  if (commandPromptText?.type === "text") {
    assert.match(commandPromptText.text, /MC 继续/u);
    assert.match(commandPromptText.text, /list_drafts/u);
    assert.match(commandPromptText.text, /MC 提交/u);
    assert.match(commandPromptText.text, /preview_commit/u);
  }
  const editPrompt = await client.getPrompt({
    name: "mini_canvas_edit_note",
    arguments: {
      path: "Notes/Test.md",
      request: "Add a short summary.",
    },
  });
  const editPromptText = editPrompt.messages[0]?.content;
  assert.equal(editPromptText?.type, "text");
  if (editPromptText?.type === "text") {
    assert.match(editPromptText.text, /edit_note_in_mini_canvas/u);
    assert.match(editPromptText.text, /text-only host/u);
    assert.match(editPromptText.text, /Do not call commit_draft/u);
  }

  const resources = await client.listResources();
  assert.equal(resources.resources.length, 11);
  const currentResource = resources.resources.find(
    (resource) => resource.uri === MINI_CANVAS_WIDGET_URI,
  );
  assert.equal(currentResource?.mimeType, "text/html;profile=mcp-app");
  const widget = await client.readResource({ uri: MINI_CANVAS_WIDGET_URI });
  const widgetContent = widget.contents[0];
  assert.equal(widgetContent && "text" in widgetContent, true);
  if (!widgetContent || !("text" in widgetContent)) {
    throw new Error("Widget resource did not return HTML text");
  }
  assert.equal(widgetContent.mimeType, "text/html;profile=mcp-app");
  assert.match(widgetContent.text, /id="mini-canvas-root"/u);
  assert.match(widgetContent.text, /new DecompressionStream\("gzip"\)/u);
  assert.match(widgetContent.text, /@font-face/u);
  assert.match(widgetContent.text, /data:font\/woff2;base64,/u);
  assert.doesNotMatch(widgetContent.text, /format\("woff"\)/u);
  assert.doesNotMatch(widgetContent.text, /format\("truetype"\)/u);
  assert.ok(
    Buffer.byteLength(widgetContent.text, "utf8") < 1_050_000,
    "Widget template should remain below 1 MiB while retaining KaTeX fonts",
  );
  const compressedScript = widgetContent.text.match(
    /const encoded="([A-Za-z0-9+/=]+)"/u,
  )?.[1];
  assert.ok(compressedScript, "Widget template should contain its gzip payload");
  const decompressedScript = gunzipSync(
    Buffer.from(compressedScript, "base64"),
  ).toString("utf8");
  assert.match(decompressedScript, /mini-canvas-root/u);
  assert.match(decompressedScript, /createRoot/u);
  assert.doesNotMatch(widgetContent.text, /process\.env\.NODE_ENV/u);
  assert.doesNotMatch(widgetContent.text, /MINI_CANVAS_MCP_AUTH_JSON/u);

  const legacyWidget = await client.readResource({
    uri: "ui://mini-canvas/editor-v4.html",
  });
  assert.equal(legacyWidget.contents[0]?.uri, "ui://mini-canvas/editor-v4.html");
  assert.equal(
    legacyWidget.contents[0]?.mimeType,
    "text/html;profile=mcp-app",
  );

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
  assert.equal(
    ((launchResult._meta as { draft?: { content?: string } } | undefined)?.draft)
      ?.content,
    "# MCP",
  );
  assert.equal(
    ((launchResult._meta as { draft?: { isNew?: boolean } } | undefined)?.draft)
      ?.isNew,
    false,
  );
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

  const dedicatedNewLaunch = await client.callTool({
    name: "create_note_in_mini_canvas",
    arguments: {
      path: "Notes/Dedicated create.md",
      content: "# Created through the dedicated tool",
    },
  });
  assert.equal(dedicatedNewLaunch.isError, undefined);
  assert.equal(
    (dedicatedNewLaunch.structuredContent as { isNew?: boolean }).isNew,
    true,
  );
  assert.equal(
    ((dedicatedNewLaunch._meta as { draft?: { content?: string } } | undefined)
      ?.draft)?.content,
    "# Created through the dedicated tool",
  );
  const dedicatedDraftId = (
    dedicatedNewLaunch.structuredContent as { draftId?: string }
  ).draftId;
  assert.equal(typeof dedicatedDraftId, "string");

  const listedDrafts = await client.callTool({
    name: "list_drafts",
    arguments: {
      path: "Notes/Dedicated create.md",
      status: "active",
    },
  });
  assert.equal(
    (listedDrafts.structuredContent as { count?: number }).count,
    1,
  );
  assert.equal(
    (
      listedDrafts.structuredContent as {
        drafts?: Array<{ id?: string; path?: string; content?: string }>;
      }
    ).drafts?.[0]?.id,
    dedicatedDraftId,
  );
  assert.equal(
    "content" in
      ((listedDrafts.structuredContent as { drafts: Array<object> }).drafts[0] ??
        {}),
    false,
  );

  const reopenedDraft = await client.callTool({
    name: "open_draft_in_mini_canvas",
    arguments: { draftId: dedicatedDraftId },
  });
  assert.equal(
    (reopenedDraft.structuredContent as { draftId?: string }).draftId,
    dedicatedDraftId,
  );
  assert.equal(
    ((reopenedDraft._meta as { draft?: { content?: string } } | undefined)?.draft)
      ?.content,
    "# Created through the dedicated tool",
  );

  const resumedByPath = await client.callTool({
    name: "open_mini_canvas",
    arguments: { path: "Notes/Dedicated create.md" },
  });
  assert.equal(resumedByPath.isError, undefined);
  assert.equal(
    (resumedByPath.structuredContent as { draftId?: string }).draftId,
    dedicatedDraftId,
  );
  assert.equal(
    (resumedByPath.structuredContent as { resumed?: boolean }).resumed,
    true,
  );

  const editedLaunch = await client.callTool({
    name: "edit_note_in_mini_canvas",
    arguments: {
      path: "Notes/Test.md",
      content: "# MCP revised in one step",
    },
  });
  assert.equal(editedLaunch.isError, undefined);
  assert.equal(
    (editedLaunch.structuredContent as { isNew?: boolean }).isNew,
    false,
  );
  assert.equal(
    ((editedLaunch._meta as { draft?: { content?: string } } | undefined)?.draft)
      ?.content,
    "# MCP revised in one step",
  );
  assert.equal((await gateway.readNote("Notes/Test.md")).content, "# MCP");
  await client.close();
  await server.close();
  database.close();
});

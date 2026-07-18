import assert from "node:assert/strict";
import test from "node:test";

import {
  RevisionConflictError,
  decodeLiveSyncFileParts,
  LiveSyncBridge,
  liveSyncPathToDocumentId,
  mimeTypeForPath,
  normalisePath,
  vaultEntryKind,
} from "../src/bridge.ts";
import { CouchDbHttpError } from "../src/couchdb.ts";
import type {
  LiveSyncMetadataDocument,
  NoteSnapshot,
} from "../src/types.ts";

test("escapes CouchDB-reserved path prefixes as ordinary LiveSync IDs", () => {
  const id = liveSyncPathToDocumentId("_design/views/note.md", true);

  assert.equal(id, "/_design/views/note.md");
  assert.equal(
    encodeURIComponent(id),
    "%2F_design%2Fviews%2Fnote.md",
  );
});

test("normalizes Windows-style paths and case when configured", () => {
  assert.equal(
    liveSyncPathToDocumentId("Folder\\Note.md", true),
    "folder/note.md",
  );
  assert.throws(() => normalisePath("C:\\private\\note.md"), /不安全/u);
});

test("decodes plain UTF-8 files and validates their byte length", () => {
  const content = "中文 SVG <svg />";
  const bytes = decodeLiveSyncFileParts(
    "plain",
    ["中文 ", "SVG <svg />"],
    Buffer.byteLength(content, "utf8"),
  );

  assert.equal(Buffer.from(bytes).toString("utf8"), content);
  assert.throws(
    () => decodeLiveSyncFileParts("plain", [content], 1),
    /文件大小校验失败/u,
  );
});

test("decodes every newnote chunk as independent Base64", () => {
  const first = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const second = Buffer.from([0xff, 0x00, 0x7f]);
  const bytes = decodeLiveSyncFileParts(
    "newnote",
    [first.toString("base64"), second.toString("base64")],
    first.byteLength + second.byteLength,
  );

  assert.deepEqual(Buffer.from(bytes), Buffer.concat([first, second]));
  assert.throws(
    () => decodeLiveSyncFileParts("newnote", ["not base64"], 1),
    /严格 Base64/u,
  );
});

test("classifies Vault entries and common MIME types", () => {
  assert.equal(vaultEntryKind("Folder/Note.md"), "note");
  assert.equal(vaultEntryKind("Folder/diagram.svg"), "attachment");
  assert.equal(mimeTypeForPath("Folder/diagram.svg"), "image/svg+xml; charset=utf-8");
  assert.equal(mimeTypeForPath("Folder/archive.unknown"), "application/octet-stream");
});

function metadata(path: string, revision: string): LiveSyncMetadataDocument {
  return {
    _id: path,
    _rev: revision,
    children: ["h:chunk"],
    path,
    ctime: 1,
    mtime: 2,
    size: 3,
    type: "plain",
  };
}

test("lists only Vault metadata with stable cursors and filters", async () => {
  const documents = [
    metadata("Notes/A.md", "1-a"),
    { _id: "h:chunk", _rev: "1-c", type: "leaf", data: "secret" },
    metadata("Notes/B.md", "2-b"),
    metadata("Assets/image.svg", "1-s"),
  ];
  const bridge = new LiveSyncBridge({
    couchDbUrl: "http://127.0.0.1:1",
    database: "test",
    username: "test",
    password: "test",
    passphrase: "test",
    caseInsensitive: true,
  });
  Object.defineProperty(bridge, "couch", {
    value: {
      getDatabaseInfo: async () => ({ update_seq: "10-checkpoint" }),
      listDocumentsPage: async (afterId: string | undefined, limit: number) => {
        const start = afterId
          ? documents.findIndex((document) => document._id === afterId) + 1
          : 0;
        return {
          rows: documents.slice(start, start + limit).map((document) => ({
            id: document._id,
            key: document._id,
            value: { rev: document._rev },
            doc: document,
          })),
        };
      },
    },
  });

  const first = await bridge.listEntries({ kinds: ["note"], limit: 1 });
  assert.equal(first.entries[0]?.path, "Notes/A.md");
  assert.equal(first.baselineSequence, "10-checkpoint");
  assert.ok(first.nextCursor);
  const second = await bridge.listEntries({
    kinds: ["note"],
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.equal(second.entries[0]?.path, "Notes/B.md");
  assert.equal(second.baselineSequence, first.baselineSequence);

  const assets = await bridge.listEntries({ prefix: "Assets", limit: 10 });
  assert.deepEqual(assets.entries.map((entry) => entry.kind), ["attachment"]);
});

test("turns CouchDB changes into file-level upserts and deletes", async () => {
  const bridge = new LiveSyncBridge({
    couchDbUrl: "http://127.0.0.1:1",
    database: "test",
    username: "test",
    password: "test",
    passphrase: "test",
    caseInsensitive: true,
  });
  Object.defineProperty(bridge, "couch", {
    value: {
      pollChanges: async () => ({
        results: [
          {
            seq: "11-a",
            id: "Notes/A.md",
            changes: [{ rev: "2-a" }],
            doc: metadata("Notes/A.md", "2-a"),
          },
          {
            seq: "12-b",
            id: "h:deleted-chunk",
            changes: [{ rev: "2-c" }],
            deleted: true,
          },
          {
            seq: "13-c",
            id: "Notes/Deleted.md",
            changes: [{ rev: "3-d" }],
            deleted: true,
          },
        ],
        last_seq: "13-c",
        pending: 0,
      }),
    },
  });

  const batch = await bridge.pollChanges({ since: "10-checkpoint", timeoutMs: 1_000 });
  assert.deepEqual(
    batch.events.map((event) => [event.path, event.operation]),
    [
      ["Notes/A.md", "upsert"],
      ["Notes/Deleted.md", "delete"],
    ],
  );
  assert.equal(batch.nextSequence, "13-c");
});

function createTestBridge(): LiveSyncBridge {
  return new LiveSyncBridge({
    couchDbUrl: "http://127.0.0.1:1",
    database: "test",
    username: "test",
    password: "test",
    passphrase: "test",
    caseInsensitive: true,
  });
}

test("turns a final metadata 409 into a revision conflict", async () => {
  const bridge = createTestBridge();
  const original = metadata("Notes/Race.md", "1-original");
  const current: NoteSnapshot = {
    path: "Notes/Race.md",
    content: "Obsidian won the race",
    revision: "2-obsidian",
    ctime: 1,
    mtime: 3,
    size: 21,
    children: ["h:obsidian"],
  };
  Object.defineProperty(bridge, "couch", {
    value: {
      getLocalDocumentOrNull: async () => null,
      getDocument: async () => original,
      putDocument: async () => {
        throw new CouchDbHttpError(
          409,
          { error: "conflict", reason: "Document update conflict." },
          "PUT",
          "Notes%2FRace.md",
        );
      },
    },
  });
  const internals = bridge as unknown as {
    ensureChunk(content: string): Promise<string>;
  };
  internals.ensureChunk = async () => "h:proposed";
  bridge.readNote = async () => current;

  await assert.rejects(
    bridge.commitNote({
      path: "Notes/Race.md",
      content: "Bridge proposed content",
      expectedRevision: "1-original",
      idempotencyKey: "race-key",
    }),
    (error: unknown) =>
      error instanceof RevisionConflictError &&
      error.expectedRevision === "1-original" &&
      error.actualRevision === "2-obsidian",
  );
});

test("idempotent replay returns the immutable first commit result", async () => {
  const bridge = createTestBridge();
  const path = "Notes/Replay.md";
  const content = "first committed content";
  let commitRecord: Record<string, unknown> | null = null;
  Object.defineProperty(bridge, "couch", {
    value: {
      getLocalDocumentOrNull: async () => commitRecord,
      getDocument: async () => metadata(path, "1-base"),
      putDocument: async () => ({ ok: true, id: path, rev: "2-first" }),
      putLocalDocument: async (_id: string, record: Record<string, unknown>) => {
        commitRecord = record;
        return { ok: true, id: _id, rev: "0-1" };
      },
    },
  });
  const internals = bridge as unknown as {
    ensureChunk(value: string): Promise<string>;
  };
  internals.ensureChunk = async () => "h:first";

  const first = await bridge.commitNote({
    path,
    content,
    expectedRevision: "1-base",
    idempotencyKey: "same-key",
  });
  const storedResult = (commitRecord as { result?: Record<string, unknown> } | null)
    ?.result;
  assert.ok(storedResult);
  assert.equal(Object.hasOwn(storedResult, "content"), false);

  bridge.readNote = async () => {
    throw new Error("replay must not read the later live document");
  };

  const replay = await bridge.commitNote({
    path,
    content,
    expectedRevision: "1-base",
    idempotencyKey: "same-key",
  });

  assert.deepEqual(replay, { ...first, idempotentReplay: true });
});

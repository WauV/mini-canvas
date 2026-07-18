import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_STORAGE_PREFIX,
  LEGACY_DOCUMENT_V2_KEY,
  LocalStorageDocumentRepository,
  RECOVERY_STORAGE_KEY,
} from "../app/lib/documents/local-storage-repository.ts";
import {
  createDocumentSnapshot,
  DEFAULT_DOCUMENT_ID,
  DocumentConflictError,
} from "../app/lib/documents/types.ts";
import { DocumentSaveQueue } from "../app/lib/documents/save-queue.ts";

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

test("migrates the v2 local document on its first repository save", async () => {
  const storage = new MemoryStorage();
  storage.setItem(
    LEGACY_DOCUMENT_V2_KEY,
    JSON.stringify({
      version: 2,
      title: "旧标题",
      content: "旧内容",
      updatedAt: 123,
    }),
  );
  const repository = new LocalStorageDocumentRepository(storage);
  const loaded = await repository.load(DEFAULT_DOCUMENT_ID);

  assert.equal(loaded?.version, "legacy-123");
  assert.equal(loaded?.content, "旧内容");

  const saved = await repository.save(loaded!, {
    expectedVersion: loaded!.version,
    idempotencyKey: "migration",
  });

  assert.match(saved.version, /^local-/);
  assert.equal(storage.getItem(LEGACY_DOCUMENT_V2_KEY), null);
  assert.ok(storage.getItem(DOCUMENT_STORAGE_PREFIX + DEFAULT_DOCUMENT_ID));
});

test("enforces expected versions and idempotent saves", async () => {
  const storage = new MemoryStorage();
  const repository = new LocalStorageDocumentRepository(storage);
  const initial = createDocumentSnapshot("标题", "正文");
  const saved = await repository.save(initial, {
    expectedVersion: "0",
    idempotencyKey: "save-1",
  });
  const repeated = await repository.save(
    { ...saved, content: "不应覆盖" },
    {
      expectedVersion: saved.version,
      idempotencyKey: "save-1",
    },
  );

  assert.equal(repeated.content, "正文");
  await assert.rejects(
    repository.save(initial, {
      expectedVersion: "0",
      idempotencyKey: "stale-save",
    }),
    DocumentConflictError,
  );
});

test("keeps a recovery snapshot outside the primary document slot", async () => {
  const storage = new MemoryStorage();
  const repository = new LocalStorageDocumentRepository(storage);
  const document = createDocumentSnapshot("可恢复", "重要内容");

  await repository.backup(document);
  assert.ok(storage.getItem(RECOVERY_STORAGE_KEY));
  assert.deepEqual(await repository.loadRecovery(), document);

  await repository.clearRecovery();
  assert.equal(await repository.loadRecovery(), null);
});

test("serializes document saves instead of running them concurrently", async () => {
  const queue = new DocumentSaveQueue();
  const events: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.run(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = queue.run(async () => {
    events.push("second:start");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst?.();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
});

test("continues the save queue after a failed operation", async () => {
  const queue = new DocumentSaveQueue();
  const failed = queue.run(async () => {
    throw new Error("save failed");
  });
  const recovered = queue.run(async () => "saved");

  await assert.rejects(failed, /save failed/u);
  assert.equal(await recovered, "saved");
});

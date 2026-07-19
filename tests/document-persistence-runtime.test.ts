import assert from "node:assert/strict";
import { test } from "vitest";

import { DocumentPersistenceRuntime } from "../app/lib/documents/document-persistence-runtime.ts";
import {
  DocumentConflictError,
  type DocumentRepository,
  type DocumentSnapshot,
} from "../app/lib/documents/types.ts";

function snapshot(content = "# 初始", version = "v1"): DocumentSnapshot {
  return {
    id: "default",
    title: "测试笔记",
    content,
    version,
    updatedAt: 1,
  };
}

class RecordingRepository implements DocumentRepository {
  readonly savedContents: string[] = [];
  activeSaves = 0;
  maxConcurrentSaves = 0;
  private version = 1;

  async load(): Promise<DocumentSnapshot | null> {
    return null;
  }

  async save(
    document: DocumentSnapshot,
  ): Promise<DocumentSnapshot> {
    this.activeSaves += 1;
    this.maxConcurrentSaves = Math.max(
      this.maxConcurrentSaves,
      this.activeSaves,
    );
    await Promise.resolve();
    this.savedContents.push(document.content);
    this.activeSaves -= 1;
    this.version += 1;
    return {
      ...document,
      version: `v${this.version}`,
      updatedAt: this.version,
    };
  }

  async backup(): Promise<void> {}
  async loadRecovery(): Promise<DocumentSnapshot | null> {
    return null;
  }
  async clearRecovery(): Promise<void> {}
}

test("skips a save when title and content already match persisted state", async () => {
  const document = snapshot();
  const repository = new RecordingRepository();
  const runtime = new DocumentPersistenceRuntime(document);
  runtime.activate(repository, document, true);

  const outcome = await runtime.persist(repository);

  assert.deepEqual(outcome, { kind: "unchanged" });
  assert.equal(repository.savedContents.length, 0);
});

test("saves an edited snapshot and accepts the returned version", async () => {
  const document = snapshot();
  const repository = new RecordingRepository();
  const runtime = new DocumentPersistenceRuntime(document);
  runtime.activate(repository, document, true);
  runtime.update({ content: "# 修改后" });

  const outcome = await runtime.persist(repository);

  assert.equal(outcome.kind, "saved");
  assert.equal(outcome.kind === "saved" && outcome.settled, true);
  assert.equal(runtime.currentDocument().version, "v2");
  assert.equal(runtime.currentDocument().content, "# 修改后");
  assert.equal(runtime.isCurrentPersisted(), true);
});

test("blocks ordinary retries after conflict but allows explicit resolution", async () => {
  const document = snapshot();
  const conflictRepository: DocumentRepository = {
    async load() {
      return snapshot("# 外部版本", "v2");
    },
    async save(_document, options) {
      throw new DocumentConflictError(options.expectedVersion, "v2");
    },
    async backup() {},
    async loadRecovery() {
      return null;
    },
    async clearRecovery() {},
  };
  const runtime = new DocumentPersistenceRuntime(document);
  runtime.activate(conflictRepository, document, true);
  runtime.update({ content: "# 本地版本" });

  const conflict = await runtime.persist(conflictRepository);
  assert.deepEqual(conflict, {
    kind: "conflict",
    conflict: { expectedVersion: "v1", actualVersion: "v2" },
  });
  assert.deepEqual(await runtime.persist(conflictRepository), { kind: "blocked" });

  const succeedingRepository = new RecordingRepository();
  const pending = runtime.rebaseVersion("v2");
  const resolved = await runtime.persist(succeedingRepository, {
    expectedVersion: "v2",
    pendingDocument: pending,
    resolveConflict: true,
  });
  assert.equal(resolved.kind, "saved");
  assert.equal(runtime.unresolvedConflict(), null);
});

test("serializes multiple pending writes through one save queue", async () => {
  const document = snapshot();
  const repository = new RecordingRepository();
  const runtime = new DocumentPersistenceRuntime(document);
  runtime.activate(repository, document, true);

  const first = runtime.persist(repository, {
    pendingDocument: { ...document, content: "第一版" },
  });
  const second = runtime.persist(repository, {
    pendingDocument: { ...document, content: "第二版" },
  });
  await Promise.all([first, second]);

  assert.deepEqual(repository.savedContents, ["第一版", "第二版"]);
  assert.equal(repository.maxConcurrentSaves, 1);
  assert.equal(runtime.currentDocument().version, "v3");
});

test("guards conflict resolution against double entry", () => {
  const runtime = new DocumentPersistenceRuntime(snapshot());

  assert.equal(runtime.beginResolution(), true);
  assert.equal(runtime.resolutionInProgress(), true);
  assert.equal(runtime.beginResolution(), false);
  runtime.finishResolution();
  assert.equal(runtime.resolutionInProgress(), false);
});

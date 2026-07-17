import {
  DEFAULT_DOCUMENT_ID,
  DocumentConflictError,
  type DocumentRepository,
  type DocumentSnapshot,
  type SaveDocumentOptions,
} from "./types.ts";

export const DOCUMENT_STORAGE_PREFIX = "mini-canvas:document:v3:";
export const RECOVERY_STORAGE_KEY = "mini-canvas:document:recovery:v1";
export const LEGACY_DOCUMENT_V2_KEY = "mini-canvas:document:v2";
export const LEGACY_DOCUMENT_V1_KEY = "mini-canvas:document:v1";

type KeyValueStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type StoredDocumentEnvelope = {
  schemaVersion: 1;
  document: DocumentSnapshot;
  lastIdempotencyKey: string;
};

type RecoveryEnvelope = {
  schemaVersion: 1;
  backedUpAt: number;
  document: DocumentSnapshot;
};

type LegacyV2Document = {
  version: 2;
  title: string;
  content: string;
  updatedAt: number;
};

function isDocumentSnapshot(value: unknown): value is DocumentSnapshot {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<DocumentSnapshot>;
  return (
    typeof document.id === "string" &&
    typeof document.title === "string" &&
    typeof document.content === "string" &&
    typeof document.version === "string" &&
    typeof document.updatedAt === "number"
  );
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function createLocalVersion(): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return "local-" + Date.now().toString(36) + "-" + suffix;
}

export class LocalStorageDocumentRepository implements DocumentRepository {
  readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage) {
    this.storage = storage;
  }

  private keyFor(id: string): string {
    return DOCUMENT_STORAGE_PREFIX + id;
  }

  private readEnvelope(id: string): StoredDocumentEnvelope | null {
    const value = parseJson(this.storage.getItem(this.keyFor(id)));
    if (!value || typeof value !== "object") return null;
    const envelope = value as Partial<StoredDocumentEnvelope>;
    if (
      envelope.schemaVersion !== 1 ||
      !isDocumentSnapshot(envelope.document) ||
      typeof envelope.lastIdempotencyKey !== "string"
    ) {
      return null;
    }
    return envelope as StoredDocumentEnvelope;
  }

  private readLegacyDocument(id: string): DocumentSnapshot | null {
    if (id !== DEFAULT_DOCUMENT_ID) return null;

    const legacyV2 = parseJson(
      this.storage.getItem(LEGACY_DOCUMENT_V2_KEY),
    );
    if (legacyV2 && typeof legacyV2 === "object") {
      const document = legacyV2 as Partial<LegacyV2Document>;
      if (
        document.version === 2 &&
        typeof document.title === "string" &&
        typeof document.content === "string" &&
        typeof document.updatedAt === "number"
      ) {
        return {
          id,
          title: document.title,
          content: document.content,
          version: "legacy-" + document.updatedAt,
          updatedAt: document.updatedAt,
        };
      }
    }

    const legacyContent = this.storage.getItem(LEGACY_DOCUMENT_V1_KEY);
    if (legacyContent !== null) {
      return {
        id,
        title: "我的第一篇笔记",
        content: legacyContent,
        version: "legacy-v1",
        updatedAt: 0,
      };
    }

    return null;
  }

  async load(id: string): Promise<DocumentSnapshot | null> {
    return this.readEnvelope(id)?.document ?? this.readLegacyDocument(id);
  }

  async save(
    document: DocumentSnapshot,
    options: SaveDocumentOptions,
  ): Promise<DocumentSnapshot> {
    const envelope = this.readEnvelope(document.id);
    if (envelope?.lastIdempotencyKey === options.idempotencyKey) {
      return envelope.document;
    }

    const current = envelope?.document ?? this.readLegacyDocument(document.id);
    const actualVersion = current?.version ?? "0";
    if (actualVersion !== options.expectedVersion) {
      throw new DocumentConflictError(
        options.expectedVersion,
        actualVersion,
      );
    }

    const saved: DocumentSnapshot = {
      ...document,
      version: createLocalVersion(),
      updatedAt: Date.now(),
    };
    const nextEnvelope: StoredDocumentEnvelope = {
      schemaVersion: 1,
      document: saved,
      lastIdempotencyKey: options.idempotencyKey,
    };

    this.storage.setItem(
      this.keyFor(document.id),
      JSON.stringify(nextEnvelope),
    );
    this.storage.removeItem(LEGACY_DOCUMENT_V2_KEY);
    this.storage.removeItem(LEGACY_DOCUMENT_V1_KEY);
    return saved;
  }

  async backup(document: DocumentSnapshot): Promise<void> {
    const envelope: RecoveryEnvelope = {
      schemaVersion: 1,
      backedUpAt: Date.now(),
      document,
    };
    this.storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(envelope));
  }

  async loadRecovery(): Promise<DocumentSnapshot | null> {
    const value = parseJson(this.storage.getItem(RECOVERY_STORAGE_KEY));
    if (!value || typeof value !== "object") return null;
    const envelope = value as Partial<RecoveryEnvelope>;
    if (envelope.schemaVersion !== 1 || !isDocumentSnapshot(envelope.document)) {
      return null;
    }
    return envelope.document;
  }

  async clearRecovery(): Promise<void> {
    this.storage.removeItem(RECOVERY_STORAGE_KEY);
  }
}

export const DEFAULT_DOCUMENT_ID = "default";

export type DocumentSnapshot = {
  id: string;
  title: string;
  content: string;
  version: string;
  updatedAt: number;
};

export type SaveDocumentOptions = {
  expectedVersion: string;
  idempotencyKey: string;
};

export interface DocumentRepository {
  load(id: string): Promise<DocumentSnapshot | null>;

  save(
    document: DocumentSnapshot,
    options: SaveDocumentOptions,
  ): Promise<DocumentSnapshot>;

  backup(document: DocumentSnapshot): Promise<void>;
  loadRecovery(): Promise<DocumentSnapshot | null>;
  clearRecovery(): Promise<void>;
}

export class DocumentConflictError extends Error {
  readonly expectedVersion: string;
  readonly actualVersion: string;

  constructor(expectedVersion: string, actualVersion: string) {
    super("文档版本已经变化，请先处理冲突再保存。");
    this.name = "DocumentConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export function createDocumentSnapshot(
  title: string,
  content: string,
): DocumentSnapshot {
  return {
    id: DEFAULT_DOCUMENT_ID,
    title,
    content,
    version: "0",
    updatedAt: 0,
  };
}

export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return "local-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

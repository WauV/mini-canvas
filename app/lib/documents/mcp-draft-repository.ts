import {
  DocumentConflictError,
  type DocumentRepository,
  type DocumentSnapshot,
  type SaveDocumentOptions,
} from "./types.ts";
import {
  type CommitDraftResult,
  type CommitPreview,
  type DraftSnapshot,
  McpDraftConflictError,
  MiniCanvasMcpClient,
} from "../mcp/mini-canvas-client.ts";

export function titleFromVaultPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

function toDocument(draft: DraftSnapshot): DocumentSnapshot {
  return {
    id: draft.id,
    title: titleFromVaultPath(draft.path),
    content: draft.content,
    version: String(draft.version),
    updatedAt: draft.updatedAt,
  };
}

function numericVersion(value: string): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("MCP 草稿版本无效");
  }
  return version;
}

export type DocumentRecoveryStore = Pick<
  DocumentRepository,
  "backup" | "loadRecovery" | "clearRecovery"
>;

export class MemoryDocumentRecoveryStore implements DocumentRecoveryStore {
  private recovery: DocumentSnapshot | null = null;

  async backup(document: DocumentSnapshot): Promise<void> {
    this.recovery = { ...document };
  }

  async loadRecovery(): Promise<DocumentSnapshot | null> {
    return this.recovery ? { ...this.recovery } : null;
  }

  async clearRecovery(): Promise<void> {
    this.recovery = null;
  }
}

export class McpDraftDocumentRepository implements DocumentRepository {
  private readonly client: MiniCanvasMcpClient;
  private readonly recovery: DocumentRecoveryStore;
  private currentDraft: DraftSnapshot;
  private readonly onDraftChange?: (draft: DraftSnapshot) => void;

  constructor(options: {
    client: MiniCanvasMcpClient;
    draft: DraftSnapshot;
    recovery: DocumentRecoveryStore;
    onDraftChange?: (draft: DraftSnapshot) => void;
  }) {
    this.client = options.client;
    this.currentDraft = options.draft;
    this.recovery = options.recovery;
    this.onDraftChange = options.onDraftChange;
  }

  get draft(): DraftSnapshot {
    return this.currentDraft;
  }

  private accept(draft: DraftSnapshot): DraftSnapshot {
    this.currentDraft = draft;
    this.onDraftChange?.(draft);
    return draft;
  }

  async load(): Promise<DocumentSnapshot> {
    return toDocument(this.accept(await this.client.getDraft(this.currentDraft.id)));
  }

  async save(
    document: DocumentSnapshot,
    options: SaveDocumentOptions,
  ): Promise<DocumentSnapshot> {
    try {
      const draft = await this.client.updateDraft({
        draftId: this.currentDraft.id,
        content: document.content,
        expectedVersion: numericVersion(options.expectedVersion),
      });
      return toDocument(this.accept(draft));
    } catch (error) {
      if (error instanceof McpDraftConflictError) {
        throw new DocumentConflictError(
          String(error.expectedVersion),
          String(error.actualVersion),
        );
      }
      throw error;
    }
  }

  async backup(document: DocumentSnapshot): Promise<void> {
    await this.recovery.backup(document);
  }

  loadRecovery(): Promise<DocumentSnapshot | null> {
    return this.recovery.loadRecovery();
  }

  clearRecovery(): Promise<void> {
    return this.recovery.clearRecovery();
  }

  previewCommit(expectedVersion: string): Promise<CommitPreview> {
    return this.client.previewCommit(
      this.currentDraft.id,
      numericVersion(expectedVersion),
    );
  }

  async commit(
    expectedVersion: string,
    idempotencyKey: string,
    confirmationToken: string,
  ): Promise<CommitDraftResult> {
    const result = await this.client.commitDraft({
      draftId: this.currentDraft.id,
      expectedVersion: numericVersion(expectedVersion),
      idempotencyKey,
      confirmationToken,
    });
    this.accept(result.draft);
    return result;
  }
}

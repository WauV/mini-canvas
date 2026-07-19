import { LocalStorageDocumentRepository } from "./local-storage-repository";
import { DocumentSaveQueue } from "./save-queue";
import type { SaveConflict } from "./document-persistence-state";
import {
  createIdempotencyKey,
  DocumentConflictError,
  type DocumentRepository,
  type DocumentSnapshot,
} from "./types";

export type ActivateDocumentOptions = {
  persisted: boolean;
  saveState?: "saved" | "saving" | "error" | "conflict";
};

export type EnqueueSaveOptions = {
  expectedVersion?: string;
  pendingDocument?: DocumentSnapshot;
  resolveConflict?: boolean;
};

export type SaveOutcome =
  | { kind: "blocked" }
  | { kind: "unchanged" }
  | {
      kind: "saved";
      version: string;
      updatedAt: number;
      settled: boolean;
    }
  | { kind: "conflict"; conflict: SaveConflict }
  | { kind: "error" };

type EditableDocumentFields = Partial<
  Pick<DocumentSnapshot, "title" | "content">
>;

type PersistedContent = Pick<DocumentSnapshot, "title" | "content">;

export class DocumentPersistenceRuntime {
  private activeRepository: DocumentRepository | null = null;
  private browserRepository: LocalStorageDocumentRepository | null = null;
  private current: DocumentSnapshot;
  private version: string;
  private conflict: SaveConflict | null = null;
  private persistedContent: PersistedContent | null = null;
  private readonly saveQueue = new DocumentSaveQueue();
  private resolving = false;

  constructor(initialDocument: DocumentSnapshot) {
    this.current = initialDocument;
    this.version = initialDocument.version;
  }

  currentDocument(): DocumentSnapshot {
    return { ...this.current, version: this.version };
  }

  repository(): DocumentRepository | null {
    return this.activeRepository;
  }

  localRepository(): LocalStorageDocumentRepository | null {
    return this.browserRepository;
  }

  unresolvedConflict(): SaveConflict | null {
    return this.conflict;
  }

  setLocalRepository(repository: LocalStorageDocumentRepository): void {
    this.browserRepository = repository;
  }

  activate(
    repository: DocumentRepository | null,
    document: DocumentSnapshot,
    persisted: boolean,
  ): void {
    this.activeRepository = repository;
    this.current = document;
    this.version = document.version;
    this.conflict = null;
    this.persistedContent = persisted
      ? { title: document.title, content: document.content }
      : null;
  }

  update(fields: EditableDocumentFields): DocumentSnapshot {
    this.current = { ...this.current, ...fields };
    return this.currentDocument();
  }

  acceptVersion(version: string, updatedAt: number): DocumentSnapshot {
    this.version = version;
    this.current = { ...this.current, version, updatedAt };
    this.conflict = null;
    return this.currentDocument();
  }

  rebaseVersion(version: string): DocumentSnapshot {
    this.version = version;
    this.current = { ...this.current, version };
    return this.currentDocument();
  }

  isCurrentPersisted(): boolean {
    return (
      this.persistedContent?.title === this.current.title &&
      this.persistedContent.content === this.current.content
    );
  }

  beginResolution(): boolean {
    if (this.resolving) return false;
    this.resolving = true;
    return true;
  }

  resolutionInProgress(): boolean {
    return this.resolving;
  }

  finishResolution(): void {
    this.resolving = false;
  }

  persist(
    repository: DocumentRepository,
    options: EnqueueSaveOptions = {},
  ): Promise<SaveOutcome> {
    return this.saveQueue.run(async () => {
      if (this.conflict && !options.resolveConflict) {
        return { kind: "blocked" };
      }

      const pendingDocument = options.pendingDocument ?? this.currentDocument();
      if (!options.resolveConflict && this.isSameAsPersisted(pendingDocument)) {
        return { kind: "unchanged" };
      }

      const expectedVersion = options.expectedVersion ?? this.version;
      try {
        const savedDocument = await repository.save(
          { ...pendingDocument, version: expectedVersion },
          { expectedVersion, idempotencyKey: createIdempotencyKey() },
        );
        this.persistedContent = {
          title: pendingDocument.title,
          content: pendingDocument.content,
        };
        this.version = savedDocument.version;
        this.current = {
          ...this.current,
          version: savedDocument.version,
          updatedAt: savedDocument.updatedAt,
        };
        this.conflict = null;
        return {
          kind: "saved",
          version: savedDocument.version,
          updatedAt: savedDocument.updatedAt,
          settled:
            this.current.title === pendingDocument.title &&
            this.current.content === pendingDocument.content,
        };
      } catch (error: unknown) {
        if (error instanceof DocumentConflictError) {
          this.conflict = {
            expectedVersion: error.expectedVersion,
            actualVersion: error.actualVersion,
          };
          return { kind: "conflict", conflict: this.conflict };
        }
        return { kind: "error" };
      }
    });
  }

  private isSameAsPersisted(document: DocumentSnapshot): boolean {
    return (
      this.persistedContent?.title === document.title &&
      this.persistedContent.content === document.content
    );
  }
}

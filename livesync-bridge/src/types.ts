export type LiveSyncMetadataDocument = {
  _id: string;
  _rev: string;
  children: string[];
  path: string;
  ctime: number;
  mtime: number;
  size: number;
  type: string;
  eden?: Record<string, unknown>;
  [key: string]: unknown;
};

export type LiveSyncChunkDocument = {
  _id: string;
  _rev?: string;
  data: string;
  type: "leaf";
  e_?: boolean;
  [key: string]: unknown;
};

export type LiveSyncParametersDocument = {
  _id: string;
  _rev?: string;
  type: "sync-parameters";
  protocolVersion: number;
  pbkdf2salt: string;
  [key: string]: unknown;
};

export type NoteSnapshot = {
  path: string;
  content: string;
  revision: string;
  ctime: number;
  mtime: number;
  size: number;
  children: string[];
};

export type VaultEntryKind = "note" | "attachment";

export type VaultEntrySummary = {
  path: string;
  kind: VaultEntryKind;
  mimeType: string;
  revision: string;
  ctime: number;
  mtime: number;
  size: number;
};

export type ListVaultEntriesInput = {
  cursor?: string;
  limit?: number;
  prefix?: string;
  kinds?: VaultEntryKind[];
  extensions?: string[];
};

export type ListVaultEntriesResult = {
  entries: VaultEntrySummary[];
  nextCursor?: string;
  baselineSequence: string;
};

export type VaultChangeEvent = {
  sequence: string;
  documentId: string;
  path: string;
  kind: VaultEntryKind;
  operation: "upsert" | "delete";
  revision?: string;
  ctime?: number;
  mtime?: number;
  size?: number;
  mimeType: string;
};

export type VaultChangeBatch = {
  events: VaultChangeEvent[];
  nextSequence: string;
  pending: number;
};

export type AttachmentSnapshot = {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  revision: string;
  ctime: number;
  mtime: number;
  size: number;
};

// A logical revision used only for optimistic creation. It means the target
// path must not exist at commit time; the Bridge never writes it to CouchDB.
export const NEW_NOTE_EXPECTED_REVISION = "mini-canvas:new-note:v1";

export type CommitNoteInput = {
  path: string;
  content: string;
  expectedRevision: string;
  idempotencyKey: string;
};

export type CommitNoteResult = NoteSnapshot & {
  idempotentReplay: boolean;
};

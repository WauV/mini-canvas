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

export type CommitNoteInput = {
  path: string;
  content: string;
  expectedRevision: string;
  idempotencyKey: string;
};

export type CommitNoteResult = NoteSnapshot & {
  idempotentReplay: boolean;
};

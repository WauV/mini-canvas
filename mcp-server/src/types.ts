export const MCP_SCOPES = [
  "notes:read",
  "vault:list",
  "attachments:read",
  "drafts:write",
  "drafts:commit",
  "search:read",
  "search:refresh",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export type Principal = {
  userId: string;
  scopes: McpScope[];
  allowedPaths: string[];
};

export type DraftStatus = "active" | "committed" | "expired";

export type DraftSnapshot = {
  id: string;
  userId: string;
  path: string;
  content: string;
  baseRevision: string;
  version: number;
  status: DraftStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  committedRevision?: string;
};

export type DraftWithBase = DraftSnapshot & {
  baseContent: string;
};

export type CommitPreview = {
  draftId: string;
  path: string;
  version: number;
  baseRevision: string;
  changed: boolean;
  characterDelta: number;
  lineDelta: number;
  contentSha256: string;
};

export type SearchCandidate = {
  id: string;
  path: string;
  title: string;
  revision: string;
  mtime: number;
  size: number;
  score: number;
};

export type SearchResult = SearchCandidate & {
  snippet: string;
};

export type SearchHealth = {
  status: "uninitialized" | "indexing" | "ready" | "degraded" | "stopped";
  lastSequence?: string;
  lastEventAt?: number;
  lastError?: string;
};

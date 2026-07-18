import { createHash } from "node:crypto";
import { extname } from "node:path";

import type {
  AttachmentSnapshot,
  CommitNoteResult,
  ListVaultEntriesInput,
  ListVaultEntriesResult,
  NoteSnapshot,
} from "../../livesync-bridge/src/types.ts";
import { Authorizer } from "./auth.ts";
import type { NoteGateway } from "./bridge-client.ts";
import { DraftConflictError, DraftRepository, DraftStateError } from "./drafts.ts";
import { createSnippet, SearchCoordinator } from "./search.ts";
import type {
  CommitPreview,
  DraftSnapshot,
  Principal,
  SearchResult,
} from "./types.ts";

function lineCount(content: string): number {
  if (!content) return 0;
  return content.endsWith("\n")
    ? content.slice(0, -1).split("\n").length
    : content.split("\n").length;
}

export class SearchNotReadyError extends Error {
  constructor() {
    super("搜索索引尚未就绪");
    this.name = "SearchNotReadyError";
  }
}

export class MiniCanvasService {
  private readonly gateway: NoteGateway;
  private readonly drafts: DraftRepository;
  private readonly search: SearchCoordinator;
  private readonly authorizer: Authorizer;

  constructor(options: {
    gateway: NoteGateway;
    drafts: DraftRepository;
    search: SearchCoordinator;
    authorizer?: Authorizer;
  }) {
    this.gateway = options.gateway;
    this.drafts = options.drafts;
    this.search = options.search;
    this.authorizer = options.authorizer ?? new Authorizer();
  }

  async listEntries(
    principal: Principal,
    input: ListVaultEntriesInput,
  ): Promise<ListVaultEntriesResult> {
    this.authorizer.requireScope(principal, "vault:list");
    if (input.prefix) this.authorizer.requirePath(principal, input.prefix);
    const result = await this.gateway.listEntries(input);
    return {
      ...result,
      entries: result.entries.filter((entry) =>
        this.authorizer.canAccessPath(principal, entry.path),
      ),
    };
  }

  async readAttachment(
    principal: Principal,
    rawPath: string,
  ): Promise<AttachmentSnapshot> {
    this.authorizer.requireScope(principal, "attachments:read");
    const path = this.authorizer.requirePath(principal, rawPath);
    if (extname(path).toLowerCase() === ".md") {
      throw new Error("Markdown 笔记必须通过 fetch 或草稿工具读取");
    }
    return this.gateway.readAttachment(path);
  }

  async createDraft(
    principal: Principal,
    input: { path: string; expiresInHours?: number },
  ): Promise<DraftSnapshot> {
    this.authorizer.requireScope(principal, "notes:read");
    this.authorizer.requireScope(principal, "drafts:write");
    const path = this.authorizer.requirePath(principal, input.path);
    if (extname(path).toLowerCase() !== ".md") {
      throw new Error("第一版草稿只支持已有 Markdown 笔记");
    }
    const note = await this.gateway.readNote(path);
    return this.drafts.create({
      userId: principal.userId,
      path: note.path,
      content: note.content,
      baseRevision: note.revision,
      expiresInHours: input.expiresInHours,
    });
  }

  getDraft(principal: Principal, draftId: string): DraftSnapshot {
    this.authorizer.requireScope(principal, "drafts:write");
    const draft = this.drafts.get(draftId, principal.userId);
    this.authorizer.requirePath(principal, draft.path);
    return draft;
  }

  updateDraft(
    principal: Principal,
    input: { draftId: string; content: string; expectedVersion: number },
  ): DraftSnapshot {
    this.authorizer.requireScope(principal, "drafts:write");
    const current = this.drafts.get(input.draftId, principal.userId);
    this.authorizer.requirePath(principal, current.path);
    return this.drafts.update({
      id: input.draftId,
      userId: principal.userId,
      content: input.content,
      expectedVersion: input.expectedVersion,
    });
  }

  previewCommit(
    principal: Principal,
    input: { draftId: string; expectedVersion: number },
  ): CommitPreview {
    this.authorizer.requireScope(principal, "drafts:write");
    const draft = this.drafts.getWithBase(input.draftId, principal.userId);
    this.authorizer.requirePath(principal, draft.path);
    if (draft.status !== "active") throw new DraftStateError(draft.status);
    if (draft.version !== input.expectedVersion) {
      throw new DraftConflictError(input.expectedVersion, draft.version);
    }
    return {
      draftId: draft.id,
      path: draft.path,
      version: draft.version,
      baseRevision: draft.baseRevision,
      changed: draft.content !== draft.baseContent,
      characterDelta: [...draft.content].length - [...draft.baseContent].length,
      lineDelta: lineCount(draft.content) - lineCount(draft.baseContent),
      contentSha256: createHash("sha256").update(draft.content, "utf8").digest("hex"),
    };
  }

  async commitDraft(
    principal: Principal,
    input: {
      draftId: string;
      expectedVersion: number;
      idempotencyKey: string;
    },
  ): Promise<{ draft: DraftSnapshot; note: CommitNoteResult }> {
    this.authorizer.requireScope(principal, "drafts:commit");
    const draft = this.drafts.getWithBase(input.draftId, principal.userId);
    this.authorizer.requirePath(principal, draft.path);
    if (draft.version !== input.expectedVersion) {
      throw new DraftConflictError(input.expectedVersion, draft.version);
    }
    if (draft.status === "expired") throw new DraftStateError(draft.status);
    if (draft.status === "committed") {
      const current = await this.gateway.readNote(draft.path);
      if (current.content !== draft.content) throw new DraftStateError(draft.status);
      return {
        draft: this.drafts.get(draft.id, principal.userId),
        note: { ...current, idempotentReplay: true },
      };
    }
    const note = await this.gateway.commitNote({
      path: draft.path,
      content: draft.content,
      expectedRevision: draft.baseRevision,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      draft: this.drafts.markCommitted({
        id: draft.id,
        userId: principal.userId,
        expectedVersion: draft.version,
        revision: note.revision,
      }),
      note,
    };
  }

  async searchNotes(
    principal: Principal,
    query: string,
    limit = 10,
  ): Promise<SearchResult[]> {
    this.authorizer.requireScope(principal, "search:read");
    const health = this.search.health();
    if (health.status === "uninitialized" || health.status === "indexing") {
      throw new SearchNotReadyError();
    }
    const candidates = this.search.index.search(query, Math.min(limit * 10, 100));
    const results: SearchResult[] = [];
    for (const candidate of candidates) {
      if (!this.authorizer.canAccessPath(principal, candidate.path)) continue;
      const note = await this.gateway.readNote(candidate.path);
      results.push({
        ...candidate,
        revision: note.revision,
        mtime: note.mtime,
        size: note.size,
        snippet: createSnippet(note.content, query),
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  async fetchNote(principal: Principal, id: string): Promise<NoteSnapshot & { id: string; title: string }> {
    this.authorizer.requireScope(principal, "search:read");
    this.authorizer.requireScope(principal, "notes:read");
    const candidate = this.search.index.getById(id);
    if (!candidate) throw new Error("搜索文档不存在");
    this.authorizer.requirePath(principal, candidate.path);
    return { ...(await this.gateway.readNote(candidate.path)), id, title: candidate.title };
  }

  async refreshSearch(principal: Principal): Promise<void> {
    this.authorizer.requireScope(principal, "search:refresh");
    await this.search.refresh(false);
  }
}

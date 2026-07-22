import { createHash, randomBytes } from "node:crypto";
import { extname } from "node:path";

import type {
  AttachmentSnapshot,
  CommitNoteResult,
  ListVaultEntriesInput,
  ListVaultEntriesResult,
  NoteSnapshot,
} from "../../livesync-bridge/src/types.ts";
import { NEW_NOTE_EXPECTED_REVISION } from "../../livesync-bridge/src/types.ts";
import { Authorizer } from "./auth.ts";
import { BridgeHttpError, type NoteGateway } from "./bridge-client.ts";
import { DraftConflictError, DraftRepository, DraftStateError } from "./drafts.ts";
import { createSnippet, SearchCoordinator } from "./search.ts";
import type {
  CommitPreview,
  DraftSnapshot,
  DraftStatus,
  DraftSummary,
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

export class CommitPreviewRequiredError extends Error {
  constructor() {
    super("提交确认无效或已过期，请重新生成并审核提交预览");
    this.name = "CommitPreviewRequiredError";
  }
}

type CommitConfirmation = {
  userId: string;
  draftId: string;
  version: number;
  contentSha256: string;
  expiresAt: number;
};

const COMMIT_CONFIRMATION_TTL_MS = 10 * 60 * 1_000;

export class MiniCanvasService {
  private readonly gateway: NoteGateway;
  private readonly drafts: DraftRepository;
  private readonly search: SearchCoordinator;
  private readonly authorizer: Authorizer;
  private readonly commitConfirmations = new Map<string, CommitConfirmation>();

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
    input: {
      path: string;
      expiresInHours?: number;
      createIfMissing?: boolean;
      content?: string;
    },
  ): Promise<DraftSnapshot> {
    this.authorizer.requireScope(principal, "notes:read");
    this.authorizer.requireScope(principal, "drafts:write");
    const path = this.authorizer.requirePath(principal, input.path);
    if (extname(path).toLowerCase() !== ".md") {
      throw new Error("草稿只支持 Markdown 笔记（.md）");
    }
    let note: NoteSnapshot;
    try {
      note = await this.gateway.readNote(path);
    } catch (error) {
      const missing =
        error instanceof BridgeHttpError &&
        error.status === 404 &&
        error.code === "note_not_found";
      if (!missing) throw error;
      if (!input.createIfMissing) {
        throw new Error("目标笔记不存在，无法编辑；若要新建请使用新建笔记流程");
      }
      return this.drafts.create({
        userId: principal.userId,
        path,
        content: input.content ?? "",
        baseContent: "",
        baseRevision: NEW_NOTE_EXPECTED_REVISION,
        expiresInHours: input.expiresInHours,
      });
    }
    if (input.createIfMissing && input.content !== undefined) {
      throw new Error("目标笔记已经存在；请先打开已有笔记再编辑，未覆盖原文");
    }
    return this.drafts.create({
      userId: principal.userId,
      path: note.path,
      content: input.content ?? note.content,
      baseContent: note.content,
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

  listDrafts(
    principal: Principal,
    input: { path?: string; status?: DraftStatus; limit?: number } = {},
  ): DraftSummary[] {
    this.authorizer.requireScope(principal, "drafts:write");
    const path =
      input.path === undefined
        ? undefined
        : this.authorizer.requirePath(principal, input.path);
    return this.drafts
      .list(principal.userId, {
        ...input,
        ...(path === undefined ? {} : { path }),
      })
      .filter((draft) => this.authorizer.canAccessPath(principal, draft.path));
  }

  findActiveDraftByPath(
    principal: Principal,
    rawPath: string,
  ): DraftSnapshot | null {
    this.authorizer.requireScope(principal, "drafts:write");
    const path = this.authorizer.requirePath(principal, rawPath);
    const summary = this.drafts.list(principal.userId, {
      path,
      status: "active",
      limit: 1,
    })[0];
    return summary ? this.drafts.get(summary.id, principal.userId) : null;
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
    const contentSha256 = createHash("sha256")
      .update(draft.content, "utf8")
      .digest("hex");
    const confirmationToken = randomBytes(32).toString("base64url");
    const now = Date.now();
    for (const [token, confirmation] of this.commitConfirmations) {
      if (confirmation.expiresAt <= now) this.commitConfirmations.delete(token);
    }
    this.commitConfirmations.set(confirmationToken, {
      userId: principal.userId,
      draftId: draft.id,
      version: draft.version,
      contentSha256,
      expiresAt: now + COMMIT_CONFIRMATION_TTL_MS,
    });
    return {
      draftId: draft.id,
      path: draft.path,
      version: draft.version,
      confirmationToken,
      baseRevision: draft.baseRevision,
      isNew: draft.isNew,
      changed: draft.isNew || draft.content !== draft.baseContent,
      characterDelta: [...draft.content].length - [...draft.baseContent].length,
      lineDelta: lineCount(draft.content) - lineCount(draft.baseContent),
      contentSha256,
    };
  }

  async commitDraft(
    principal: Principal,
    input: {
      draftId: string;
      expectedVersion: number;
      idempotencyKey: string;
      confirmationToken: string;
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
    const confirmation = this.commitConfirmations.get(input.confirmationToken);
    const contentSha256 = createHash("sha256")
      .update(draft.content, "utf8")
      .digest("hex");
    if (
      !confirmation ||
      confirmation.expiresAt <= Date.now() ||
      confirmation.userId !== principal.userId ||
      confirmation.draftId !== draft.id ||
      confirmation.version !== draft.version ||
      confirmation.contentSha256 !== contentSha256
    ) {
      if (confirmation) this.commitConfirmations.delete(input.confirmationToken);
      throw new CommitPreviewRequiredError();
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

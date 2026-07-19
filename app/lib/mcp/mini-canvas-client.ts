import type {
  McpDisplayMode,
  McpImageContent,
  McpToolClient,
  McpToolResult,
  McpToolResultListener,
} from "./tool-client.ts";

export type VaultNoteEntry = {
  path: string;
  revision: string;
  mtime: number;
  size: number;
};

export type VaultEntryKind = "note" | "attachment";

export type VaultEntry = VaultNoteEntry & {
  kind: VaultEntryKind;
  mimeType: string;
  ctime: number;
};

export type ListVaultEntriesInput = {
  prefix?: string;
  kinds?: VaultEntryKind[];
  extensions?: string[];
  limit?: number;
};

export type ReadAttachmentResult = {
  path: string;
  mimeType: string;
  revision: string;
  size: number;
} & (
  | { delivery: "image"; data: string }
  | { delivery: "text"; text: string }
  | { delivery: "metadata_only" }
);

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

export type CommitDraftResult = {
  draft: DraftSnapshot;
  note: {
    path: string;
    content: string;
    revision: string;
    mtime: number;
    size: number;
    idempotentReplay: boolean;
  };
};

export class McpServiceError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "McpServiceError";
    this.code = code;
  }
}

export class McpDraftConflictError extends McpServiceError {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super("加密草稿版本已经变化", "draft_conflict");
    this.name = "McpDraftConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class McpRevisionConflictError extends McpServiceError {
  readonly expectedRevision: string;
  readonly actualRevision: string;

  constructor(expectedRevision: string, actualRevision: string) {
    super("Obsidian 笔记在草稿期间已经变化", "revision_conflict");
    this.name = "McpRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpServiceError(`${label} 返回格式无效`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string") {
    throw new McpServiceError(`MCP 字段 ${key} 格式无效`);
  }
  return value[key] as string;
}

function numberField(value: Record<string, unknown>, key: string): number {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
    throw new McpServiceError(`MCP 字段 ${key} 格式无效`);
  }
  return value[key] as number;
}

function booleanField(value: Record<string, unknown>, key: string): boolean {
  if (typeof value[key] !== "boolean") {
    throw new McpServiceError(`MCP 字段 ${key} 格式无效`);
  }
  return value[key] as boolean;
}

function parseVaultEntry(value: unknown): VaultEntry {
  const entry = record(value, "Vault 条目");
  const kind = stringField(entry, "kind");
  if (kind !== "note" && kind !== "attachment") {
    throw new McpServiceError("MCP Vault 条目类型无效");
  }
  return {
    path: stringField(entry, "path"),
    kind,
    mimeType: stringField(entry, "mimeType"),
    revision: stringField(entry, "revision"),
    ctime: numberField(entry, "ctime"),
    mtime: numberField(entry, "mtime"),
    size: numberField(entry, "size"),
  };
}

function isBase64(value: string): boolean {
  return (
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  );
}

function parseDraft(value: unknown): DraftSnapshot {
  const item = record(value, "草稿工具");
  const status = stringField(item, "status");
  if (status !== "active" && status !== "committed" && status !== "expired") {
    throw new McpServiceError("MCP 草稿状态无效");
  }
  const committedRevision = item.committedRevision;
  return {
    id: stringField(item, "id"),
    userId: stringField(item, "userId"),
    path: stringField(item, "path"),
    content: stringField(item, "content"),
    baseRevision: stringField(item, "baseRevision"),
    version: numberField(item, "version"),
    status,
    createdAt: numberField(item, "createdAt"),
    updatedAt: numberField(item, "updatedAt"),
    expiresAt: numberField(item, "expiresAt"),
    ...(typeof committedRevision === "string" ? { committedRevision } : {}),
  };
}

function parsePreview(value: unknown): CommitPreview {
  const item = record(value, "提交预览");
  return {
    draftId: stringField(item, "draftId"),
    path: stringField(item, "path"),
    version: numberField(item, "version"),
    baseRevision: stringField(item, "baseRevision"),
    changed: booleanField(item, "changed"),
    characterDelta: numberField(item, "characterDelta"),
    lineDelta: numberField(item, "lineDelta"),
    contentSha256: stringField(item, "contentSha256"),
  };
}

function textError(result: McpToolResult): string {
  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") return item.text;
  }
  return "MCP 工具调用失败";
}

function throwToolError(result: McpToolResult): never {
  const message = textError(result);
  try {
    const value: unknown = JSON.parse(message);
    const item = record(value, "MCP 错误");
    if (
      item.error === "draft_conflict" &&
      typeof item.expectedVersion === "number" &&
      typeof item.actualVersion === "number"
    ) {
      throw new McpDraftConflictError(item.expectedVersion, item.actualVersion);
    }
    if (
      item.error === "revision_conflict" &&
      typeof item.expectedRevision === "string" &&
      typeof item.actualRevision === "string"
    ) {
      throw new McpRevisionConflictError(item.expectedRevision, item.actualRevision);
    }
    throw new McpServiceError(message, typeof item.error === "string" ? item.error : undefined);
  } catch (error) {
    if (error instanceof McpServiceError) throw error;
    throw new McpServiceError(message);
  }
}

export class MiniCanvasMcpClient {
  private readonly tools: McpToolClient;

  constructor(tools: McpToolClient) {
    this.tools = tools;
  }

  private async structured(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await this.tools.callTool(name, arguments_);
    if (result.isError) throwToolError(result);
    if (result.structuredContent === undefined) {
      throw new McpServiceError(`${name} 没有返回结构化数据`);
    }
    return result.structuredContent;
  }

  async listEntries(input: ListVaultEntriesInput = {}): Promise<VaultEntry[]> {
    const entries: VaultEntry[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const value = record(
        await this.structured("list_entries", {
          ...input,
          limit: input.limit ?? 200,
          ...(cursor ? { cursor } : {}),
        }),
        "Vault 列表",
      );
      if (!Array.isArray(value.entries)) {
        throw new McpServiceError("MCP Vault 列表格式无效");
      }
      for (const rawEntry of value.entries) {
        entries.push(parseVaultEntry(rawEntry));
      }
      cursor = typeof value.nextCursor === "string" ? value.nextCursor : undefined;
      if (cursor) {
        if (seenCursors.has(cursor)) throw new McpServiceError("MCP 列表 cursor 重复");
        seenCursors.add(cursor);
      }
    } while (cursor);

    return entries.sort((left, right) =>
      left.path.localeCompare(right.path, "zh-CN"),
    );
  }

  async listNotes(): Promise<VaultNoteEntry[]> {
    return (await this.listEntries({ kinds: ["note"], extensions: [".md"] }))
      .filter((entry) => entry.kind === "note")
      .map(({ path, revision, mtime, size }) => ({ path, revision, mtime, size }));
  }

  async readAttachment(path: string): Promise<ReadAttachmentResult> {
    const result = await this.tools.callTool("read_attachment", { path });
    if (result.isError) throwToolError(result);
    const value = record(result.structuredContent, "附件工具");
    const common = {
      path: stringField(value, "path"),
      mimeType: stringField(value, "mimeType").split(";", 1)[0].toLowerCase(),
      revision: stringField(value, "revision"),
      size: numberField(value, "size"),
    };
    const delivery = stringField(value, "delivery");
    if (delivery === "text") {
      return { ...common, delivery, text: stringField(value, "text") };
    }
    if (delivery === "metadata_only") return { ...common, delivery };
    if (delivery !== "image") {
      throw new McpServiceError("MCP 附件交付类型无效");
    }
    const image = result.content?.find((item): item is McpImageContent => {
      const candidate = item as Record<string, unknown>;
      return (
        candidate.type === "image" &&
        typeof candidate.data === "string" &&
        typeof candidate.mimeType === "string"
      );
    });
    if (
      !image ||
      typeof image.data !== "string" ||
      typeof image.mimeType !== "string" ||
      image.mimeType.toLowerCase() !== common.mimeType ||
      !isBase64(image.data)
    ) {
      throw new McpServiceError("MCP 图片附件内容无效");
    }
    return { ...common, delivery, data: image.data };
  }

  async createDraft(path: string): Promise<DraftSnapshot> {
    return parseDraft(await this.structured("create_draft", { path }));
  }

  async getDraft(draftId: string): Promise<DraftSnapshot> {
    return parseDraft(await this.structured("get_draft", { draftId }));
  }

  async updateDraft(input: {
    draftId: string;
    content: string;
    expectedVersion: number;
  }): Promise<DraftSnapshot> {
    return parseDraft(await this.structured("update_draft", input));
  }

  async previewCommit(draftId: string, expectedVersion: number): Promise<CommitPreview> {
    return parsePreview(
      await this.structured("preview_commit", { draftId, expectedVersion }),
    );
  }

  async commitDraft(input: {
    draftId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<CommitDraftResult> {
    const value = record(await this.structured("commit_draft", input), "提交结果");
    const note = record(value.note, "提交笔记");
    return {
      draft: parseDraft(value.draft),
      note: {
        path: stringField(note, "path"),
        content: stringField(note, "content"),
        revision: stringField(note, "revision"),
        mtime: numberField(note, "mtime"),
        size: numberField(note, "size"),
        idempotentReplay: booleanField(note, "idempotentReplay"),
      },
    };
  }

  subscribeToolResults(listener: McpToolResultListener): () => void {
    return this.tools.subscribeToolResults?.(listener) ?? (() => undefined);
  }

  async requestDisplayMode(mode: McpDisplayMode): Promise<McpDisplayMode> {
    if (!this.tools.requestDisplayMode) {
      throw new McpServiceError("当前宿主不支持切换 Widget 展示模式");
    }
    return this.tools.requestDisplayMode(mode);
  }

  close(): void {
    this.tools.close?.();
  }
}

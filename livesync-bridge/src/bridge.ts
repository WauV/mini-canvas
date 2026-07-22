import { createHash } from "node:crypto";
import { extname } from "node:path";

import type { BridgeConfig } from "./config.ts";
import { CouchDbClient, CouchDbHttpError } from "./couchdb.ts";
import { decodePbkdf2Salt, LiveSyncV2Crypto } from "./crypto.ts";
import { liveSyncChunkId } from "./hash.ts";
import { NEW_NOTE_EXPECTED_REVISION } from "./types.ts";
import type {
  CommitNoteInput,
  CommitNoteResult,
  AttachmentSnapshot,
  ListVaultEntriesInput,
  ListVaultEntriesResult,
  LiveSyncChunkDocument,
  LiveSyncMetadataDocument,
  LiveSyncParametersDocument,
  NoteSnapshot,
  VaultChangeBatch,
  VaultChangeEvent,
  VaultEntryKind,
  VaultEntrySummary,
} from "./types.ts";

const SYNC_PARAMETERS_LOCAL_ID = "obsidian_livesync_sync_parameters";
const WRITE_CHUNK_UTF8_BYTES = 60 * 1024;

type CommitRecord = {
  _id: string;
  _rev?: string;
  type: "mini-canvas-idempotency";
  payloadDigest: string;
  path: string;
  revision: string;
  result?: Omit<NoteSnapshot, "content">;
  committedAt: number;
};

export class RevisionConflictError extends Error {
  readonly expectedRevision: string;
  readonly actualRevision: string;

  constructor(
    expectedRevision: string,
    actualRevision: string,
  ) {
    super(`笔记版本冲突：期望 ${expectedRevision}，当前 ${actualRevision}`);
    this.name = "RevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class AttachmentTooLargeError extends Error {
  readonly size: number;
  readonly maximum: number;

  constructor(size: number, maximum: number) {
    super(`附件大小 ${size} bytes 超过限制 ${maximum} bytes`);
    this.name = "AttachmentTooLargeError";
    this.size = size;
    this.maximum = maximum;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".tex": "text/x-tex; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".tsx": "text/typescript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function vaultEntryKind(path: string): VaultEntryKind {
  return extname(path).toLowerCase() === ".md" ? "note" : "attachment";
}

export function mimeTypeForPath(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function isMetadataDocument(value: unknown): value is LiveSyncMetadataDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<LiveSyncMetadataDocument>;
  return (
    typeof item._id === "string" &&
    typeof item._rev === "string" &&
    typeof item.path === "string" &&
    Array.isArray(item.children) &&
    typeof item.ctime === "number" &&
    typeof item.mtime === "number" &&
    typeof item.size === "number" &&
    item.type !== "leaf"
  );
}

function strictBase64Decode(value: string): Buffer {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    throw new Error("LiveSync 二进制数据块不是严格 Base64 格式");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("LiveSync 二进制数据块 Base64 校验失败");
  }
  return decoded;
}

export function decodeLiveSyncFileParts(
  type: string,
  parts: string[],
  expectedBytes: number,
): Uint8Array {
  const bytes =
    type === "newnote"
      ? Buffer.concat(parts.map(strictBase64Decode))
      : Buffer.from(parts.join(""), "utf8");
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `文件大小校验失败：元数据 ${expectedBytes} bytes，实际 ${bytes.byteLength} bytes`,
    );
  }
  return bytes;
}

type ListCursor = {
  version: 1;
  lastId: string;
  baselineSequence: string;
  filterDigest: string;
};

function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeListCursor(value: string): ListCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const cursor = parsed as Partial<ListCursor>;
    if (
      cursor.version !== 1 ||
      typeof cursor.lastId !== "string" ||
      typeof cursor.baselineSequence !== "string" ||
      typeof cursor.filterDigest !== "string"
    ) {
      throw new Error();
    }
    return cursor as ListCursor;
  } catch {
    throw new Error("列表 cursor 无效");
  }
}

function metadataToEntry(metadata: LiveSyncMetadataDocument): VaultEntrySummary {
  return {
    path: metadata.path,
    kind: vaultEntryKind(metadata.path),
    mimeType: mimeTypeForPath(metadata.path),
    revision: metadata._rev,
    ctime: metadata.ctime,
    mtime: metadata.mtime,
    size: metadata.size,
  };
}

export function normalisePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.includes("\0") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`不安全或无效的 Vault 路径：${path}`);
  }
  return normalized;
}

export function liveSyncPathToDocumentId(
  path: string,
  caseInsensitive: boolean,
): string {
  const normalized = normalisePath(path);
  const id = caseInsensitive ? normalized.toLowerCase() : normalized;

  // This leading slash is LiveSync's own escape for CouchDB-reserved IDs.
  // CouchDbClient URL-encodes the complete value, so _design/note.md becomes
  // the ordinary document ID %2F_design%2Fnote.md, not a design-document route.
  return id.startsWith("_") ? "/" + id : id;
}

function splitByUtf8Bytes(content: string, maxBytes: number): string[] {
  if (content === "") return [""];
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of content) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (current && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

export class LiveSyncBridge {
  readonly couch: CouchDbClient;
  private cryptoPromise?: Promise<LiveSyncV2Crypto>;
  private readonly config: BridgeConfig;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.couch = new CouchDbClient({
      baseUrl: config.couchDbUrl,
      database: config.database,
      username: config.username,
      password: config.password,
    });
  }

  private pathToDocumentId(path: string): string {
    return liveSyncPathToDocumentId(path, this.config.caseInsensitive);
  }

  private async crypto(): Promise<LiveSyncV2Crypto> {
    this.cryptoPromise ??= (async () => {
      const parameters =
        await this.couch.getLocalDocument<LiveSyncParametersDocument>(
          SYNC_PARAMETERS_LOCAL_ID,
        );
      if (parameters.type !== "sync-parameters" || parameters.protocolVersion !== 2) {
        throw new Error("测试 CouchDB 不是受支持的 LiveSync V2 仓库");
      }
      return new LiveSyncV2Crypto(
        this.config.passphrase,
        decodePbkdf2Salt(parameters.pbkdf2salt),
      );
    })();
    return this.cryptoPromise;
  }

  private async readChunk(
    id: string,
    metadata: LiveSyncMetadataDocument,
  ): Promise<string> {
    const document = await this.couch.getDocumentOrNull<LiveSyncChunkDocument>(id);
    if (document) {
      if (document.type !== "leaf" || typeof document.data !== "string") {
        throw new Error(`数据块 ${id} 结构异常`);
      }
      if (document.e_ !== true || !document.data.startsWith("%=")) {
        throw new Error(`数据块 ${id} 未使用预期的 LiveSync V2 加密`);
      }
      return (await this.crypto()).decrypt(document.data);
    }

    const edenValue = metadata.eden?.[id];
    if (edenValue && typeof edenValue === "object" && "data" in edenValue) {
      const data = (edenValue as { data?: unknown }).data;
      if (typeof data !== "string") throw new Error(`Eden 数据块 ${id} 结构异常`);
      return data.startsWith("%=") ? (await this.crypto()).decrypt(data) : data;
    }
    throw new Error(`缺少 LiveSync 数据块 ${id}`);
  }

  private async readFileBytes(path: string): Promise<{
    metadata: LiveSyncMetadataDocument;
    bytes: Uint8Array;
  }> {
    const normalized = normalisePath(path);
    const metadata = await this.couch.getDocument<LiveSyncMetadataDocument>(
      this.pathToDocumentId(normalized),
    );
    if (!isMetadataDocument(metadata)) {
      throw new Error(`文件元数据结构异常：${path}`);
    }
    const parts = await Promise.all(
      metadata.children.map((child) => this.readChunk(child, metadata)),
    );
    return {
      metadata,
      bytes: decodeLiveSyncFileParts(metadata.type, parts, metadata.size),
    };
  }

  async readNote(path: string): Promise<NoteSnapshot> {
    const { metadata, bytes } = await this.readFileBytes(path);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

    return {
      path: metadata.path,
      content,
      revision: metadata._rev,
      ctime: metadata.ctime,
      mtime: metadata.mtime,
      size: metadata.size,
      children: [...metadata.children],
    };
  }

  async readAttachment(
    path: string,
    maximumBytes?: number,
  ): Promise<AttachmentSnapshot> {
    const normalized = normalisePath(path);
    if (vaultEntryKind(normalized) !== "attachment") {
      throw new Error("Markdown 笔记必须通过 notes/read 读取");
    }
    if (maximumBytes !== undefined) {
      const metadata = await this.couch.getDocument<LiveSyncMetadataDocument>(
        this.pathToDocumentId(normalized),
      );
      if (!isMetadataDocument(metadata)) {
        throw new Error(`文件元数据结构异常：${path}`);
      }
      if (metadata.size > maximumBytes) {
        throw new AttachmentTooLargeError(metadata.size, maximumBytes);
      }
    }
    const { metadata, bytes } = await this.readFileBytes(normalized);
    return {
      path: metadata.path,
      bytes,
      mimeType: mimeTypeForPath(metadata.path),
      revision: metadata._rev,
      ctime: metadata.ctime,
      mtime: metadata.mtime,
      size: metadata.size,
    };
  }

  async listEntries(
    input: ListVaultEntriesInput = {},
  ): Promise<ListVaultEntriesResult> {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("列表 limit 必须是 1 到 200 之间的整数");
    }
    const prefix = input.prefix ? normalisePath(input.prefix) : "";
    const kinds = [...new Set(input.kinds ?? [])].sort();
    if (kinds.some((kind) => kind !== "note" && kind !== "attachment")) {
      throw new Error("列表 kinds 包含未知类型");
    }
    const extensions = [...new Set(input.extensions ?? [])]
      .map((value) => (value.startsWith(".") ? value : `.${value}`).toLowerCase())
      .sort();
    const filterDigest = sha256(JSON.stringify({ prefix, kinds, extensions }));
    const cursor = input.cursor ? decodeListCursor(input.cursor) : undefined;
    if (cursor && cursor.filterDigest !== filterDigest) {
      throw new Error("列表 cursor 与当前筛选条件不匹配");
    }
    const baselineSequence =
      cursor?.baselineSequence ?? String((await this.couch.getDatabaseInfo()).update_seq);
    let afterId = cursor?.lastId;
    const entries: VaultEntrySummary[] = [];
    let nextCursor: string | undefined;

    while (entries.length < limit) {
      const page = await this.couch.listDocumentsPage<LiveSyncMetadataDocument>(
        afterId,
        200,
      );
      if (page.rows.length === 0) break;

      for (let index = 0; index < page.rows.length; index += 1) {
        const row = page.rows[index];
        afterId = row.id;
        if (!isMetadataDocument(row.doc)) continue;
        let entry: VaultEntrySummary;
        try {
          entry = metadataToEntry(row.doc);
          normalisePath(entry.path);
        } catch {
          continue;
        }
        const prefixMatches =
          !prefix || entry.path === prefix || entry.path.startsWith(`${prefix}/`);
        const kindMatches = kinds.length === 0 || kinds.includes(entry.kind);
        const extensionMatches =
          extensions.length === 0 || extensions.includes(extname(entry.path).toLowerCase());
        if (!prefixMatches || !kindMatches || !extensionMatches) continue;
        entries.push(entry);
        if (entries.length === limit) {
          const definitelyMore =
            index < page.rows.length - 1 || page.rows.length === 200;
          if (definitelyMore && afterId !== undefined) {
            nextCursor = encodeListCursor({
              version: 1,
              lastId: afterId,
              baselineSequence,
              filterDigest,
            });
          }
          break;
        }
      }
      if (entries.length === limit || page.rows.length < 200) break;
    }

    return { entries, nextCursor, baselineSequence };
  }

  async pollChanges(options: {
    since: string;
    limit?: number;
    timeoutMs?: number;
  }): Promise<VaultChangeBatch> {
    const limit = options.limit ?? 100;
    const timeoutMs = options.timeoutMs ?? 25_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("变更 limit 必须是 1 到 200 之间的整数");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
      throw new Error("变更 timeoutMs 必须是 1000 到 30000 之间的整数");
    }
    const response = await this.couch.pollChanges<LiveSyncMetadataDocument>({
      since: options.since,
      limit,
      timeoutMs,
    });
    const events: VaultChangeEvent[] = [];
    for (const change of response.results) {
      if (isMetadataDocument(change.doc) && !change.deleted) {
        const entry = metadataToEntry(change.doc);
        events.push({
          sequence: String(change.seq),
          documentId: change.id,
          path: entry.path,
          kind: entry.kind,
          operation: "upsert" as const,
          revision: entry.revision,
          ctime: entry.ctime,
          mtime: entry.mtime,
          size: entry.size,
          mimeType: entry.mimeType,
        });
        continue;
      }
      if (!change.deleted || change.id.startsWith("h:") || change.id.startsWith("_")) {
        continue;
      }
      const rawPath = change.id.startsWith("/_") ? change.id.slice(1) : change.id;
      try {
        const path = normalisePath(rawPath);
        events.push({
          sequence: String(change.seq),
          documentId: change.id,
          path,
          kind: vaultEntryKind(path),
          operation: "delete" as const,
          revision: change.changes[0]?.rev,
          mimeType: mimeTypeForPath(path),
        });
      } catch {
        continue;
      }
    }
    return {
      events,
      nextSequence: String(response.last_seq),
      pending: response.pending ?? 0,
    };
  }

  private async ensureChunk(content: string): Promise<string> {
    const id = liveSyncChunkId(content, this.config.passphrase);
    const existing = await this.couch.getDocumentOrNull<LiveSyncChunkDocument>(id);
    if (existing) {
      const existingPlaintext = await this.readChunk(id, {
        _id: "",
        _rev: "",
        children: [id],
        path: "",
        ctime: 0,
        mtime: 0,
        size: Buffer.byteLength(content, "utf8"),
        type: "plain",
        eden: {},
      });
      if (existingPlaintext !== content) {
        throw new Error(`数据块哈希冲突或密钥不匹配：${id}`);
      }
      return id;
    }

    const encrypted = await (await this.crypto()).encrypt(content);
    try {
      await this.couch.putDocument<LiveSyncChunkDocument>({
        _id: id,
        data: encrypted,
        type: "leaf",
        e_: true,
      });
    } catch (error) {
      if (!(error instanceof CouchDbHttpError && error.status === 409)) throw error;
      const winner = await this.couch.getDocument<LiveSyncChunkDocument>(id);
      const plain = await (await this.crypto()).decrypt(winner.data);
      if (plain !== content) throw new Error(`并发写入的数据块不一致：${id}`);
    }
    return id;
  }

  private commitRecordId(idempotencyKey: string): string {
    return `mini_canvas_commit_${sha256(idempotencyKey)}`;
  }

  private async saveCommitRecord(
    id: string,
    payloadDigest: string,
    result: NoteSnapshot,
  ): Promise<void> {
    const existing = await this.couch.getLocalDocumentOrNull<CommitRecord>(id);
    if (existing) {
      if (existing.payloadDigest !== payloadDigest) {
        throw new Error("同一个 idempotencyKey 被用于不同的写入内容");
      }
      return;
    }
    const record: CommitRecord = {
      _id: `_local/${id}`,
      type: "mini-canvas-idempotency",
      payloadDigest,
      path: result.path,
      revision: result.revision,
      result: {
        path: result.path,
        revision: result.revision,
        ctime: result.ctime,
        mtime: result.mtime,
        size: result.size,
        children: [...result.children],
      },
      committedAt: Date.now(),
    };
    try {
      await this.couch.putLocalDocument(id, record);
    } catch (error) {
      if (!(error instanceof CouchDbHttpError && error.status === 409)) throw error;
      const winner = await this.couch.getLocalDocument<CommitRecord>(id);
      if (winner.payloadDigest !== payloadDigest) {
        throw new Error("同一个 idempotencyKey 发生并发内容冲突");
      }
    }
  }

  private async replayCommitRecord(
    record: CommitRecord,
    path: string,
    content: string,
  ): Promise<CommitNoteResult> {
    if (record.result) {
      return {
        ...record.result,
        content,
        children: [...record.result.children],
        idempotentReplay: true,
      };
    }

    // Records created by older Bridge versions did not contain the immutable
    // result. They are safe to replay only while CouchDB still points at the
    // exact revision that was originally committed.
    const current = await this.readNote(path);
    if (
      current.revision !== record.revision ||
      current.content !== content
    ) {
      throw new Error(
        "旧版幂等记录缺少原始提交快照，且笔记已经发生后续变更，无法安全重放",
      );
    }
    return { ...current, idempotentReplay: true };
  }

  async commitNote(input: CommitNoteInput): Promise<CommitNoteResult> {
    const path = normalisePath(input.path);
    if (!input.expectedRevision) throw new Error("写入必须提供 expectedRevision");
    if (!input.idempotencyKey.trim()) throw new Error("写入必须提供 idempotencyKey");
    const payloadDigest = sha256(`${path}\0${input.content}`);
    const recordId = this.commitRecordId(input.idempotencyKey);
    const existingRecord =
      await this.couch.getLocalDocumentOrNull<CommitRecord>(recordId);
    if (existingRecord) {
      if (existingRecord.payloadDigest !== payloadDigest) {
        throw new Error("同一个 idempotencyKey 被用于不同的写入内容");
      }
      return this.replayCommitRecord(existingRecord, path, input.content);
    }

    const documentId = this.pathToDocumentId(path);
    if (input.expectedRevision === NEW_NOTE_EXPECTED_REVISION) {
      const existing =
        await this.couch.getDocumentOrNull<LiveSyncMetadataDocument>(documentId);
      if (existing) {
        const current = await this.readNote(path);
        if (current.content === input.content) {
          await this.saveCommitRecord(recordId, payloadDigest, current);
          return { ...current, idempotentReplay: true };
        }
        throw new RevisionConflictError(
          NEW_NOTE_EXPECTED_REVISION,
          current.revision,
        );
      }

      const pieces = splitByUtf8Bytes(input.content, WRITE_CHUNK_UTF8_BYTES);
      const children: string[] = [];
      for (const piece of pieces) children.push(await this.ensureChunk(piece));

      const now = Date.now();
      const created = {
        _id: documentId,
        children,
        path,
        ctime: now,
        mtime: now,
        size: Buffer.byteLength(input.content, "utf8"),
        type: "plain",
        eden: {},
      };
      let response: { ok: true; id: string; rev: string };
      try {
        response = await this.couch.putDocument(created);
      } catch (error) {
        if (!(error instanceof CouchDbHttpError && error.status === 409)) {
          throw error;
        }
        const current = await this.readNote(path);
        if (current.content === input.content) {
          await this.saveCommitRecord(recordId, payloadDigest, current);
          return { ...current, idempotentReplay: true };
        }
        throw new RevisionConflictError(
          NEW_NOTE_EXPECTED_REVISION,
          current.revision,
        );
      }
      const result: NoteSnapshot = {
        path,
        content: input.content,
        revision: response.rev,
        ctime: now,
        mtime: now,
        size: created.size,
        children,
      };
      await this.saveCommitRecord(recordId, payloadDigest, result);
      return { ...result, idempotentReplay: false };
    }

    const metadata =
      await this.couch.getDocument<LiveSyncMetadataDocument>(documentId);

    if (metadata._rev !== input.expectedRevision) {
      const current = await this.readNote(path);
      if (current.content === input.content) {
        await this.saveCommitRecord(recordId, payloadDigest, current);
        return { ...current, idempotentReplay: true };
      }
      throw new RevisionConflictError(input.expectedRevision, current.revision);
    }

    const pieces = splitByUtf8Bytes(input.content, WRITE_CHUNK_UTF8_BYTES);
    const children: string[] = [];
    for (const piece of pieces) children.push(await this.ensureChunk(piece));

    const now = Date.now();
    const updated: LiveSyncMetadataDocument = {
      ...metadata,
      _id: documentId,
      _rev: metadata._rev,
      children,
      path: metadata.path || path,
      mtime: now,
      size: Buffer.byteLength(input.content, "utf8"),
      type: metadata.type || "plain",
      eden: {},
    };
    let response: { ok: true; id: string; rev: string };
    try {
      response = await this.couch.putDocument(updated);
    } catch (error) {
      if (!(error instanceof CouchDbHttpError && error.status === 409)) {
        throw error;
      }
      const current = await this.readNote(path);
      if (current.content === input.content) {
        await this.saveCommitRecord(recordId, payloadDigest, current);
        return { ...current, idempotentReplay: true };
      }
      throw new RevisionConflictError(input.expectedRevision, current.revision);
    }
    const result: NoteSnapshot = {
      path: updated.path,
      content: input.content,
      revision: response.rev,
      ctime: updated.ctime,
      mtime: updated.mtime,
      size: updated.size,
      children,
    };
    await this.saveCommitRecord(recordId, payloadDigest, result);
    return { ...result, idempotentReplay: false };
  }
}

import { createHash } from "node:crypto";

import type { BridgeConfig } from "./config.ts";
import { CouchDbClient, CouchDbHttpError } from "./couchdb.ts";
import { decodePbkdf2Salt, LiveSyncV2Crypto } from "./crypto.ts";
import { liveSyncChunkId } from "./hash.ts";
import type {
  CommitNoteInput,
  CommitNoteResult,
  LiveSyncChunkDocument,
  LiveSyncMetadataDocument,
  LiveSyncParametersDocument,
  NoteSnapshot,
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalisePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
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

  async readNote(path: string): Promise<NoteSnapshot> {
    const id = this.pathToDocumentId(path);
    const metadata = await this.couch.getDocument<LiveSyncMetadataDocument>(id);
    if (!Array.isArray(metadata.children) || typeof metadata._rev !== "string") {
      throw new Error(`笔记元数据结构异常：${path}`);
    }
    const content = (
      await Promise.all(metadata.children.map((child) => this.readChunk(child, metadata)))
    ).join("");
    const actualBytes = Buffer.byteLength(content, "utf8");
    if (actualBytes !== metadata.size) {
      throw new Error(
        `笔记 UTF-8 大小校验失败：元数据 ${metadata.size} bytes，实际 ${actualBytes} bytes`,
      );
    }

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
    path: string,
    revision: string,
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
      path,
      revision,
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
      return { ...(await this.readNote(path)), idempotentReplay: true };
    }

    const documentId = this.pathToDocumentId(path);
    const metadata =
      await this.couch.getDocument<LiveSyncMetadataDocument>(documentId);

    if (metadata._rev !== input.expectedRevision) {
      const current = await this.readNote(path);
      if (current.content === input.content) {
        await this.saveCommitRecord(
          recordId,
          payloadDigest,
          path,
          current.revision,
        );
        return { ...current, idempotentReplay: true };
      }
      throw new RevisionConflictError(input.expectedRevision, metadata._rev);
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
    const response = await this.couch.putDocument(updated);
    await this.saveCommitRecord(recordId, payloadDigest, path, response.rev);
    return {
      path: updated.path,
      content: input.content,
      revision: response.rev,
      ctime: updated.ctime,
      mtime: updated.mtime,
      size: updated.size,
      children,
      idempotentReplay: false,
    };
  }
}

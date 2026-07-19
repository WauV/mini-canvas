import { randomUUID } from "node:crypto";

import type { StatementResultingChanges } from "node:sqlite";

import { AtRestCrypto, type EncryptedValue } from "./crypto.ts";
import { McpDatabase } from "./database.ts";
import type {
  DraftSnapshot,
  DraftStatus,
  DraftWithBase,
} from "./types.ts";

type DraftRow = {
  id: string;
  user_id: string;
  path_nonce: string;
  path_ciphertext: string;
  path_tag: string;
  base_revision: string;
  version: number;
  status: DraftStatus;
  base_nonce: string;
  base_ciphertext: string;
  base_tag: string;
  current_nonce: string;
  current_ciphertext: string;
  current_tag: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
  committed_revision: string | null;
};

export class DraftNotFoundError extends Error {
  constructor() {
    super("草稿不存在");
    this.name = "DraftNotFoundError";
  }
}

export class DraftConflictError extends Error {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(`草稿版本冲突：期望 ${expectedVersion}，当前 ${actualVersion}`);
    this.name = "DraftConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class DraftStateError extends Error {
  readonly status: DraftStatus;

  constructor(status: DraftStatus) {
    super(status === "expired" ? "草稿已经过期" : "草稿已经提交");
    this.name = "DraftStateError";
    this.status = status;
  }
}

function encryptedFromRow(
  row: Record<string, unknown>,
  prefix: string,
): EncryptedValue {
  return {
    nonce: String(row[`${prefix}_nonce`]),
    ciphertext: String(row[`${prefix}_ciphertext`]),
    tag: String(row[`${prefix}_tag`]),
  };
}

function changes(result: StatementResultingChanges): number {
  return Number(result.changes);
}

export class DraftRepository {
  private readonly db: McpDatabase;
  private readonly crypto: AtRestCrypto;

  constructor(db: McpDatabase, crypto: AtRestCrypto) {
    this.db = db;
    this.crypto = crypto;
  }

  private aad(userId: string, id: string, field: string): string {
    return `draft\0${userId}\0${id}\0${field}`;
  }

  private getRow(id: string, userId: string): DraftRow {
    const row = this.db.connection
      .prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?")
      .get(id, userId) as DraftRow | undefined;
    if (!row) throw new DraftNotFoundError();
    if (row.status === "active" && row.expires_at <= Date.now()) {
      const expiredAt = Date.now();
      this.db.connection
        .prepare("UPDATE drafts SET status = 'expired', updated_at = ? WHERE id = ?")
        .run(expiredAt, id);
      row.status = "expired";
      row.updated_at = expiredAt;
    }
    return row;
  }

  private decode(row: DraftRow): DraftWithBase {
    const path = this.crypto.decryptDraft(
      encryptedFromRow(row as unknown as Record<string, unknown>, "path"),
      this.aad(row.user_id, row.id, "path"),
    );
    const content = this.crypto.decryptDraft(
      encryptedFromRow(row as unknown as Record<string, unknown>, "current"),
      this.aad(row.user_id, row.id, "current"),
    );
    const baseContent = this.crypto.decryptDraft(
      encryptedFromRow(row as unknown as Record<string, unknown>, "base"),
      this.aad(row.user_id, row.id, "base"),
    );
    return {
      id: row.id,
      userId: row.user_id,
      path,
      content,
      baseContent,
      baseRevision: row.base_revision,
      version: row.version,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      ...(row.committed_revision
        ? { committedRevision: row.committed_revision }
        : {}),
    };
  }

  create(input: {
    userId: string;
    path: string;
    content: string;
    baseRevision: string;
    expiresInHours?: number;
  }): DraftSnapshot {
    const id = randomUUID();
    const now = Date.now();
    const expiresInHours = input.expiresInHours ?? 24 * 7;
    if (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 24 * 30) {
      throw new Error("expiresInHours 必须在 1 到 720 之间");
    }
    const expiresAt = now + Math.round(expiresInHours * 60 * 60 * 1000);
    const path = this.crypto.encryptDraft(
      input.path,
      this.aad(input.userId, id, "path"),
    );
    const base = this.crypto.encryptDraft(
      input.content,
      this.aad(input.userId, id, "base"),
    );
    const current = this.crypto.encryptDraft(
      input.content,
      this.aad(input.userId, id, "current"),
    );
    this.db.connection.prepare(`
      INSERT INTO drafts (
        id, user_id, path_nonce, path_ciphertext, path_tag, base_revision,
        version, status, base_nonce, base_ciphertext, base_tag,
        current_nonce, current_ciphertext, current_tag,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.userId,
      path.nonce,
      path.ciphertext,
      path.tag,
      input.baseRevision,
      base.nonce,
      base.ciphertext,
      base.tag,
      current.nonce,
      current.ciphertext,
      current.tag,
      now,
      now,
      expiresAt,
    );
    const { baseContent, ...snapshot } = this.decode(
      this.getRow(id, input.userId),
    );
    void baseContent;
    return snapshot;
  }

  get(id: string, userId: string): DraftSnapshot {
    const { baseContent, ...snapshot } = this.decode(this.getRow(id, userId));
    void baseContent;
    return snapshot;
  }

  getWithBase(id: string, userId: string): DraftWithBase {
    return this.decode(this.getRow(id, userId));
  }

  update(input: {
    id: string;
    userId: string;
    content: string;
    expectedVersion: number;
  }): DraftSnapshot {
    const row = this.getRow(input.id, input.userId);
    if (row.status !== "active") throw new DraftStateError(row.status);
    if (row.version !== input.expectedVersion) {
      throw new DraftConflictError(input.expectedVersion, row.version);
    }
    const encrypted = this.crypto.encryptDraft(
      input.content,
      this.aad(input.userId, input.id, "current"),
    );
    const now = Date.now();
    const result = this.db.connection.prepare(`
      UPDATE drafts
      SET current_nonce = ?, current_ciphertext = ?, current_tag = ?,
          version = version + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND version = ? AND status = 'active'
    `).run(
      encrypted.nonce,
      encrypted.ciphertext,
      encrypted.tag,
      now,
      input.id,
      input.userId,
      input.expectedVersion,
    );
    if (changes(result) !== 1) {
      const latest = this.getRow(input.id, input.userId);
      throw new DraftConflictError(input.expectedVersion, latest.version);
    }
    return this.get(input.id, input.userId);
  }

  markCommitted(input: {
    id: string;
    userId: string;
    expectedVersion: number;
    revision: string;
  }): DraftSnapshot {
    const row = this.getRow(input.id, input.userId);
    if (row.status === "committed" && row.committed_revision === input.revision) {
      return this.get(input.id, input.userId);
    }
    if (row.status !== "active") throw new DraftStateError(row.status);
    if (row.version !== input.expectedVersion) {
      throw new DraftConflictError(input.expectedVersion, row.version);
    }
    const result = this.db.connection.prepare(`
      UPDATE drafts
      SET status = 'committed', committed_revision = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND version = ? AND status = 'active'
    `).run(input.revision, Date.now(), input.id, input.userId, input.expectedVersion);
    if (changes(result) !== 1) {
      const latest = this.getRow(input.id, input.userId);
      throw new DraftConflictError(input.expectedVersion, latest.version);
    }
    return this.get(input.id, input.userId);
  }
}

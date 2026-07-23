import { randomUUID } from "node:crypto";

import type { StatementResultingChanges } from "node:sqlite";

import { NEW_NOTE_EXPECTED_REVISION } from "../../livesync-bridge/src/types.ts";

import { AtRestCrypto, type EncryptedValue } from "./crypto.ts";
import { McpDatabase } from "./database.ts";
import type {
  DraftSnapshot,
  DraftStatus,
  DraftSummary,
  DraftWithBase,
} from "./types.ts";

type DraftRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  crypto_version: 1 | 2;
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

export const DEFAULT_EXPIRED_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type DraftCleanupResult = {
  markedExpired: number;
  deleted: number;
};

export class DraftRepository {
  private readonly db: McpDatabase;
  private readonly crypto: AtRestCrypto;

  constructor(db: McpDatabase, crypto: AtRestCrypto) {
    this.db = db;
    this.crypto = crypto;
  }

  private aad(
    tenantId: string,
    userId: string,
    id: string,
    field: string,
    cryptoVersion = 2,
  ): string {
    return cryptoVersion === 1
      ? `draft\0${userId}\0${id}\0${field}`
      : `draft\0${tenantId}\0${userId}\0${id}\0${field}`;
  }

  private getRow(id: string, tenantId: string, userId: string): DraftRow {
    const row = this.db.connection
      .prepare("SELECT * FROM drafts WHERE id = ? AND tenant_id = ? AND user_id = ?")
      .get(id, tenantId, userId) as DraftRow | undefined;
    if (!row) throw new DraftNotFoundError();
    if (row.status === "active" && row.expires_at <= Date.now()) {
      const expiredAt = Date.now();
      this.db.connection
        .prepare(`
          UPDATE drafts SET status = 'expired', updated_at = ?
          WHERE id = ? AND tenant_id = ? AND user_id = ?
        `)
        .run(expiredAt, id, tenantId, userId);
      row.status = "expired";
      row.updated_at = expiredAt;
    }
    return row;
  }

  private decode(row: DraftRow): DraftWithBase {
    const path = this.crypto.decryptDraft(
      encryptedFromRow(row as unknown as Record<string, unknown>, "path"),
      this.aad(row.tenant_id, row.user_id, row.id, "path", row.crypto_version),
    );
    const content = this.crypto.decryptDraft(
      encryptedFromRow(row as unknown as Record<string, unknown>, "current"),
      this.aad(row.tenant_id, row.user_id, row.id, "current", row.crypto_version),
    );
    const baseContent = this.crypto.decryptDraft(
      encryptedFromRow(row as unknown as Record<string, unknown>, "base"),
      this.aad(row.tenant_id, row.user_id, row.id, "base", row.crypto_version),
    );
    return {
      id: row.id,
      userId: row.user_id,
      path,
      content,
      baseContent,
      baseRevision: row.base_revision,
      isNew: row.base_revision === NEW_NOTE_EXPECTED_REVISION,
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

  private decodeSummary(row: DraftRow): DraftSummary {
    const path = this.crypto.decryptDraft(
      encryptedFromRow(row as unknown as Record<string, unknown>, "path"),
      this.aad(row.tenant_id, row.user_id, row.id, "path", row.crypto_version),
    );
    return {
      id: row.id,
      path,
      baseRevision: row.base_revision,
      isNew: row.base_revision === NEW_NOTE_EXPECTED_REVISION,
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

  list(
    tenantId: string,
    userId: string,
    options: {
      status?: DraftStatus;
      path?: string;
      limit?: number;
    } = {},
  ): DraftSummary[] {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("草稿列表 limit 必须在 1 到 100 之间");
    }

    const now = Date.now();
    this.db.connection.prepare(`
      UPDATE drafts
      SET status = 'expired', updated_at = ?
      WHERE tenant_id = ? AND user_id = ? AND status = 'active' AND expires_at <= ?
    `).run(now, tenantId, userId, now);

    const rows = (options.status
      ? this.db.connection.prepare(`
          SELECT * FROM drafts
          WHERE tenant_id = ? AND user_id = ? AND status = ?
          ORDER BY updated_at DESC, created_at DESC, id DESC
        `).all(tenantId, userId, options.status)
      : this.db.connection.prepare(`
          SELECT * FROM drafts
          WHERE tenant_id = ? AND user_id = ?
          ORDER BY updated_at DESC, created_at DESC, id DESC
        `).all(tenantId, userId)) as unknown as DraftRow[];

    const summaries: DraftSummary[] = [];
    for (const row of rows) {
      const summary = this.decodeSummary(row);
      if (options.path !== undefined && summary.path !== options.path) continue;
      summaries.push(summary);
      if (summaries.length === limit) break;
    }
    return summaries;
  }

  cleanupExpired(
    now = Date.now(),
    retentionMs = DEFAULT_EXPIRED_DRAFT_RETENTION_MS,
  ): DraftCleanupResult {
    if (!Number.isFinite(now) || !Number.isFinite(retentionMs) || retentionMs < 0) {
      throw new Error("草稿清理时间参数无效");
    }
    return this.db.transaction(() => {
      const markedExpired = changes(
        this.db.connection.prepare(`
          UPDATE drafts
          SET status = 'expired', updated_at = ?
          WHERE status = 'active' AND expires_at <= ?
        `).run(now, now),
      );
      const deleted = changes(
        this.db.connection.prepare(`
          DELETE FROM drafts
          WHERE status = 'expired' AND expires_at <= ?
        `).run(now - retentionMs),
      );
      return { markedExpired, deleted };
    });
  }

  create(input: {
    tenantId: string;
    userId: string;
    path: string;
    content: string;
    baseContent?: string;
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
      this.aad(input.tenantId, input.userId, id, "path"),
    );
    const base = this.crypto.encryptDraft(
      input.baseContent ?? input.content,
      this.aad(input.tenantId, input.userId, id, "base"),
    );
    const current = this.crypto.encryptDraft(
      input.content,
      this.aad(input.tenantId, input.userId, id, "current"),
    );
    this.db.connection.prepare(`
      INSERT INTO drafts (
        id, tenant_id, user_id, crypto_version,
        path_nonce, path_ciphertext, path_tag, base_revision,
        version, status, base_nonce, base_ciphertext, base_tag,
        current_nonce, current_ciphertext, current_tag,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, 2, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.tenantId,
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
      this.getRow(id, input.tenantId, input.userId),
    );
    void baseContent;
    return snapshot;
  }

  get(id: string, tenantId: string, userId: string): DraftSnapshot {
    const { baseContent, ...snapshot } = this.decode(
      this.getRow(id, tenantId, userId),
    );
    void baseContent;
    return snapshot;
  }

  getWithBase(id: string, tenantId: string, userId: string): DraftWithBase {
    return this.decode(this.getRow(id, tenantId, userId));
  }

  update(input: {
    id: string;
    tenantId: string;
    userId: string;
    content: string;
    expectedVersion: number;
  }): DraftSnapshot {
    const row = this.getRow(input.id, input.tenantId, input.userId);
    if (row.status !== "active") throw new DraftStateError(row.status);
    if (row.version !== input.expectedVersion) {
      throw new DraftConflictError(input.expectedVersion, row.version);
    }
    const encrypted = this.crypto.encryptDraft(
      input.content,
      this.aad(input.tenantId, input.userId, input.id, "current"),
    );
    const now = Date.now();
    const result = this.db.connection.prepare(`
      UPDATE drafts
      SET current_nonce = ?, current_ciphertext = ?, current_tag = ?,
          version = version + 1, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND user_id = ?
        AND version = ? AND status = 'active'
    `).run(
      encrypted.nonce,
      encrypted.ciphertext,
      encrypted.tag,
      now,
      input.id,
      input.tenantId,
      input.userId,
      input.expectedVersion,
    );
    if (changes(result) !== 1) {
      const latest = this.getRow(input.id, input.tenantId, input.userId);
      throw new DraftConflictError(input.expectedVersion, latest.version);
    }
    return this.get(input.id, input.tenantId, input.userId);
  }

  markCommitted(input: {
    id: string;
    tenantId: string;
    userId: string;
    expectedVersion: number;
    revision: string;
  }): DraftSnapshot {
    const row = this.getRow(input.id, input.tenantId, input.userId);
    if (row.status === "committed" && row.committed_revision === input.revision) {
      return this.get(input.id, input.tenantId, input.userId);
    }
    if (row.status !== "active") throw new DraftStateError(row.status);
    if (row.version !== input.expectedVersion) {
      throw new DraftConflictError(input.expectedVersion, row.version);
    }
    const result = this.db.connection.prepare(`
      UPDATE drafts
      SET status = 'committed', committed_revision = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND user_id = ?
        AND version = ? AND status = 'active'
    `).run(
      input.revision,
      Date.now(),
      input.id,
      input.tenantId,
      input.userId,
      input.expectedVersion,
    );
    if (changes(result) !== 1) {
      const latest = this.getRow(input.id, input.tenantId, input.userId);
      throw new DraftConflictError(input.expectedVersion, latest.version);
    }
    return this.get(input.id, input.tenantId, input.userId);
  }
}

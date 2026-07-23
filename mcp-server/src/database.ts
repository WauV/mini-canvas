import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export class McpDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string, legacyTenantId = "local-vault") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.connection.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL");
    this.migrate(legacyTenantId);
  }

  private schemaVersion(): number {
    return (this.connection.prepare("PRAGMA user_version").get() as {
      user_version: number;
    }).user_version;
  }

  private migrate(legacyTenantId: string): void {
    if (this.schemaVersion() < 1) this.migrateToV1();
    if (this.schemaVersion() < 2) this.migrateToV2(legacyTenantId);
  }

  private migrateToV1(): void {
    this.connection.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE drafts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        path_nonce TEXT NOT NULL,
        path_ciphertext TEXT NOT NULL,
        path_tag TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'committed', 'expired')),
        base_nonce TEXT NOT NULL,
        base_ciphertext TEXT NOT NULL,
        base_tag TEXT NOT NULL,
        current_nonce TEXT NOT NULL,
        current_ciphertext TEXT NOT NULL,
        current_tag TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        committed_revision TEXT
      );
      CREATE INDEX drafts_user_updated_idx ON drafts(user_id, updated_at DESC);

      CREATE TABLE search_documents (
        id TEXT PRIMARY KEY,
        path_nonce TEXT NOT NULL,
        path_ciphertext TEXT NOT NULL,
        path_tag TEXT NOT NULL,
        title_nonce TEXT NOT NULL,
        title_ciphertext TEXT NOT NULL,
        title_tag TEXT NOT NULL,
        revision TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        generation TEXT NOT NULL
      );
      CREATE TABLE search_terms (
        document_id TEXT NOT NULL REFERENCES search_documents(id) ON DELETE CASCADE,
        term_hash TEXT NOT NULL,
        frequency INTEGER NOT NULL,
        PRIMARY KEY (document_id, term_hash)
      );
      CREATE INDEX search_terms_hash_idx ON search_terms(term_hash);

      CREATE TABLE service_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  private migrateToV2(legacyTenantId: string): void {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.connection.exec(`
        CREATE TABLE drafts_v2 (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          crypto_version INTEGER NOT NULL CHECK (crypto_version IN (1, 2)),
          path_nonce TEXT NOT NULL,
          path_ciphertext TEXT NOT NULL,
          path_tag TEXT NOT NULL,
          base_revision TEXT NOT NULL,
          version INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'committed', 'expired')),
          base_nonce TEXT NOT NULL,
          base_ciphertext TEXT NOT NULL,
          base_tag TEXT NOT NULL,
          current_nonce TEXT NOT NULL,
          current_ciphertext TEXT NOT NULL,
          current_tag TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          committed_revision TEXT
        );
      `);
      this.connection.prepare(`
        INSERT INTO drafts_v2 (
          id, tenant_id, user_id, crypto_version,
          path_nonce, path_ciphertext, path_tag, base_revision,
          version, status, base_nonce, base_ciphertext, base_tag,
          current_nonce, current_ciphertext, current_tag,
          created_at, updated_at, expires_at, committed_revision
        )
        SELECT
          id, ?, user_id, 1,
          path_nonce, path_ciphertext, path_tag, base_revision,
          version, status, base_nonce, base_ciphertext, base_tag,
          current_nonce, current_ciphertext, current_tag,
          created_at, updated_at, expires_at, committed_revision
        FROM drafts
      `).run(legacyTenantId);
      this.connection.exec(`
        DROP TABLE drafts;
        ALTER TABLE drafts_v2 RENAME TO drafts;
        CREATE INDEX drafts_tenant_user_updated_idx
          ON drafts(tenant_id, user_id, updated_at DESC);

        DROP TABLE search_terms;
        DROP TABLE search_documents;
        DROP TABLE service_state;

        CREATE TABLE search_documents (
          tenant_id TEXT NOT NULL,
          id TEXT NOT NULL,
          path_nonce TEXT NOT NULL,
          path_ciphertext TEXT NOT NULL,
          path_tag TEXT NOT NULL,
          title_nonce TEXT NOT NULL,
          title_ciphertext TEXT NOT NULL,
          title_tag TEXT NOT NULL,
          revision TEXT NOT NULL,
          mtime INTEGER NOT NULL,
          size INTEGER NOT NULL,
          generation TEXT NOT NULL,
          PRIMARY KEY (tenant_id, id)
        );
        CREATE TABLE search_terms (
          tenant_id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          term_hash TEXT NOT NULL,
          frequency INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, document_id, term_hash),
          FOREIGN KEY (tenant_id, document_id)
            REFERENCES search_documents(tenant_id, id) ON DELETE CASCADE
        );
        CREATE INDEX search_terms_tenant_hash_idx
          ON search_terms(tenant_id, term_hash);

        CREATE TABLE service_state (
          tenant_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, key)
        );
        PRAGMA user_version = 2;
        COMMIT;
      `);
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  transaction<T>(callback: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const value = callback();
      this.connection.exec("COMMIT");
      return value;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}

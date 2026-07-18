import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export class McpDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.connection.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    const version = this.connection.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version >= 1) return;
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

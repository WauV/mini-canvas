import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  NoteSnapshot,
  VaultChangeBatch,
  VaultEntrySummary,
} from "../../livesync-bridge/src/types.ts";
import { AtRestCrypto, type EncryptedValue } from "./crypto.ts";
import { McpDatabase } from "./database.ts";
import { BridgeHttpError, type NoteGateway } from "./bridge-client.ts";
import type { SearchCandidate, SearchHealth } from "./types.ts";

type SearchDocumentRow = {
  id: string;
  path_nonce: string;
  path_ciphertext: string;
  path_tag: string;
  title_nonce: string;
  title_ciphertext: string;
  title_tag: string;
  revision: string;
  mtime: number;
  size: number;
  generation: string;
  score?: number;
};

function encryptedFromRow(row: SearchDocumentRow, prefix: "path" | "title"): EncryptedValue {
  return {
    nonce: row[`${prefix}_nonce`],
    ciphertext: row[`${prefix}_ciphertext`],
    tag: row[`${prefix}_tag`],
  };
}

export function tokenizeSearchText(value: string): Map<string, number> {
  const normalized = value.normalize("NFKC").toLowerCase();
  const frequencies = new Map<string, number>();
  const add = (term: string) => {
    if (!term) return;
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  };
  for (const match of normalized.matchAll(/[a-z0-9]+(?:['’-][a-z0-9]+)*/gu)) {
    add(match[0]);
  }
  for (const match of normalized.matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu,
  )) {
    const characters = [...match[0]];
    for (const character of characters) add(character);
    for (let index = 0; index + 1 < characters.length; index += 1) {
      add(characters[index] + characters[index + 1]);
    }
  }
  return frequencies;
}

function noteTitle(path: string): string {
  const extension = extname(path);
  return basename(path, extension);
}

export class SearchIndex {
  private readonly db: McpDatabase;
  private readonly crypto: AtRestCrypto;

  constructor(db: McpDatabase, crypto: AtRestCrypto) {
    this.db = db;
    this.crypto = crypto;
  }

  private aad(id: string, field: string): string {
    return `search\0${id}\0${field}`;
  }

  clear(): void {
    this.db.transaction(() => {
      this.db.connection.exec("DELETE FROM search_documents");
      this.db.connection
        .prepare("DELETE FROM service_state WHERE key = 'search_sequence'")
        .run();
    });
  }

  revisionForPath(path: string): string | undefined {
    const row = this.db.connection
      .prepare("SELECT revision FROM search_documents WHERE id = ?")
      .get(this.crypto.documentId(path)) as { revision: string } | undefined;
    return row?.revision;
  }

  touchGeneration(path: string, generation: string): void {
    this.db.connection
      .prepare("UPDATE search_documents SET generation = ? WHERE id = ?")
      .run(generation, this.crypto.documentId(path));
  }

  upsert(entry: VaultEntrySummary, content: string, generation: string): void {
    const id = this.crypto.documentId(entry.path);
    const path = this.crypto.encryptSearch(entry.path, this.aad(id, "path"));
    const title = this.crypto.encryptSearch(noteTitle(entry.path), this.aad(id, "title"));
    const terms = tokenizeSearchText(`${noteTitle(entry.path)}\n${content}`);
    this.db.transaction(() => {
      this.db.connection.prepare(`
        INSERT INTO search_documents (
          id, path_nonce, path_ciphertext, path_tag,
          title_nonce, title_ciphertext, title_tag,
          revision, mtime, size, generation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          path_nonce = excluded.path_nonce,
          path_ciphertext = excluded.path_ciphertext,
          path_tag = excluded.path_tag,
          title_nonce = excluded.title_nonce,
          title_ciphertext = excluded.title_ciphertext,
          title_tag = excluded.title_tag,
          revision = excluded.revision,
          mtime = excluded.mtime,
          size = excluded.size,
          generation = excluded.generation
      `).run(
        id,
        path.nonce,
        path.ciphertext,
        path.tag,
        title.nonce,
        title.ciphertext,
        title.tag,
        entry.revision,
        entry.mtime,
        entry.size,
        generation,
      );
      this.db.connection
        .prepare("DELETE FROM search_terms WHERE document_id = ?")
        .run(id);
      const insert = this.db.connection.prepare(
        "INSERT INTO search_terms(document_id, term_hash, frequency) VALUES (?, ?, ?)",
      );
      for (const [term, frequency] of terms) {
        insert.run(id, this.crypto.searchTerm(term), frequency);
      }
    });
  }

  upsertNote(note: NoteSnapshot, generation: string): void {
    this.upsert(
      {
        path: note.path,
        kind: "note",
        mimeType: "text/markdown; charset=utf-8",
        revision: note.revision,
        ctime: note.ctime,
        mtime: note.mtime,
        size: note.size,
      },
      note.content,
      generation,
    );
  }

  removePath(path: string): void {
    this.db.connection
      .prepare("DELETE FROM search_documents WHERE id = ?")
      .run(this.crypto.documentId(path));
  }

  sweepGeneration(generation: string): void {
    this.db.connection
      .prepare("DELETE FROM search_documents WHERE generation <> ?")
      .run(generation);
  }

  getSequence(): string | undefined {
    const row = this.db.connection
      .prepare("SELECT value FROM service_state WHERE key = 'search_sequence'")
      .get() as { value: string } | undefined;
    return row?.value;
  }

  setSequence(sequence: string): void {
    this.db.connection.prepare(`
      INSERT INTO service_state(key, value, updated_at)
      VALUES ('search_sequence', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(sequence, Date.now());
  }

  private decode(row: SearchDocumentRow): SearchCandidate {
    return {
      id: row.id,
      path: this.crypto.decryptSearch(
        encryptedFromRow(row, "path"),
        this.aad(row.id, "path"),
      ),
      title: this.crypto.decryptSearch(
        encryptedFromRow(row, "title"),
        this.aad(row.id, "title"),
      ),
      revision: row.revision,
      mtime: row.mtime,
      size: row.size,
      score: Number(row.score ?? 0),
    };
  }

  getById(id: string): SearchCandidate | undefined {
    const row = this.db.connection
      .prepare("SELECT *, 0 AS score FROM search_documents WHERE id = ?")
      .get(id) as SearchDocumentRow | undefined;
    return row ? this.decode(row) : undefined;
  }

  search(query: string, limit = 20): SearchCandidate[] {
    const terms = [...tokenizeSearchText(query).keys()];
    if (terms.length === 0) return [];
    const hashes = [...new Set(terms.map((term) => this.crypto.searchTerm(term)))];
    const placeholders = hashes.map(() => "?").join(", ");
    const rows = this.db.connection.prepare(`
      SELECT d.*, COUNT(DISTINCT t.term_hash) * 1000 + SUM(t.frequency) AS score
      FROM search_terms t
      JOIN search_documents d ON d.id = t.document_id
      WHERE t.term_hash IN (${placeholders})
      GROUP BY d.id
      ORDER BY COUNT(DISTINCT t.term_hash) DESC, SUM(t.frequency) DESC, d.mtime DESC
      LIMIT ?
    `).all(...hashes, Math.max(1, Math.min(limit, 100))) as SearchDocumentRow[];
    return rows.map((row) => this.decode(row));
  }
}

export function createSnippet(content: string, query: string, maximum = 240): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  if (compact.length <= maximum) return compact;
  const index = compact.toLowerCase().indexOf(query.trim().toLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - Math.floor(maximum / 3));
  const end = Math.min(compact.length, start + maximum);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${
    end < compact.length ? "…" : ""
  }`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SearchCoordinator {
  readonly index: SearchIndex;
  private readonly gateway: NoteGateway;
  private healthState: SearchHealth = { status: "uninitialized" };
  private stopped = true;
  private loopPromise?: Promise<void>;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(index: SearchIndex, gateway: NoteGateway) {
    this.index = index;
    this.gateway = gateway;
  }

  health(): SearchHealth {
    return { ...this.healthState };
  }

  private exclusive<T>(callback: () => Promise<T>): Promise<T> {
    const result = this.operation.then(callback, callback);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async refresh(rebuild = false): Promise<void> {
    try {
      await this.exclusive(async () => {
        this.healthState = { status: "indexing" };
        if (rebuild) this.index.clear();
        const generation = randomUUID();
        let cursor: string | undefined;
        let baselineSequence: string | undefined;
        do {
          const page = await this.gateway.listEntries({
            cursor,
            limit: 100,
            kinds: ["note"],
            extensions: [".md"],
          });
          baselineSequence ??= page.baselineSequence;
          for (const entry of page.entries) {
            if (this.index.revisionForPath(entry.path) === entry.revision) {
              this.index.touchGeneration(entry.path, generation);
              continue;
            }
            const note = await this.gateway.readNote(entry.path);
            this.index.upsertNote(note, generation);
          }
          cursor = page.nextCursor;
        } while (cursor);
        this.index.sweepGeneration(generation);
        this.index.setSequence(baselineSequence ?? "0");
        this.healthState = {
          status: "ready",
          lastSequence: baselineSequence ?? "0",
          lastEventAt: Date.now(),
        };
      });
    } catch (error) {
      this.healthState = {
        ...this.healthState,
        status: "degraded",
        lastError: error instanceof Error ? error.message : "索引刷新失败",
      };
      throw error;
    }
  }

  private async applyBatch(batch: VaultChangeBatch): Promise<void> {
    await this.exclusive(async () => {
      const generation = randomUUID();
      for (const event of batch.events) {
        if (event.kind !== "note") continue;
        if (event.operation === "delete") {
          this.index.removePath(event.path);
          continue;
        }
        if (event.revision && this.index.revisionForPath(event.path) === event.revision) {
          continue;
        }
        try {
          this.index.upsertNote(await this.gateway.readNote(event.path), generation);
        } catch (error) {
          if (error instanceof BridgeHttpError && error.status === 404) {
            this.index.removePath(event.path);
            continue;
          }
          // Do not advance the opaque checkpoint past an event that was not
          // indexed. Earlier events in this batch are safe to replay because
          // upserts and deletes are idempotent.
          throw error;
        }
      }
      this.index.setSequence(batch.nextSequence);
      this.healthState = {
        status: "ready",
        lastSequence: batch.nextSequence,
        lastEventAt: Date.now(),
      };
    });
  }

  private async loop(): Promise<void> {
    let retryMs = 1_000;
    while (!this.stopped) {
      const sequence = this.index.getSequence();
      if (!sequence) return;
      try {
        const batch = await this.gateway.pollChanges({
          since: sequence,
          limit: 200,
          timeoutMs: 25_000,
        });
        await this.applyBatch(batch);
        retryMs = 1_000;
      } catch (error) {
        this.healthState = {
          ...this.healthState,
          status: "degraded",
          lastError: error instanceof Error ? error.message : "未知监听错误",
        };
        if (this.stopped) return;
        await sleep(retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    }
  }

  async start(autoIndex: boolean): Promise<void> {
    if (this.index.getSequence()) {
      this.healthState = {
        status: "ready",
        lastSequence: this.index.getSequence(),
      };
    } else if (autoIndex) {
      await this.refresh(false);
    }
    if (!this.index.getSequence()) return;
    this.stopped = false;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loopPromise;
    this.healthState = { ...this.healthState, status: "stopped" };
  }
}

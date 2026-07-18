import type {
  AttachmentSnapshot,
  CommitNoteInput,
  CommitNoteResult,
  ListVaultEntriesInput,
  ListVaultEntriesResult,
  NoteSnapshot,
  VaultChangeBatch,
} from "../../livesync-bridge/src/types.ts";

export interface NoteGateway {
  health(): Promise<boolean>;
  readNote(path: string): Promise<NoteSnapshot>;
  commitNote(input: CommitNoteInput): Promise<CommitNoteResult>;
  listEntries(input: ListVaultEntriesInput): Promise<ListVaultEntriesResult>;
  pollChanges(input: {
    since: string;
    limit?: number;
    timeoutMs?: number;
  }): Promise<VaultChangeBatch>;
  readAttachment(path: string): Promise<AttachmentSnapshot>;
}

export class BridgeHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, details: Record<string, unknown>) {
    super(`LiveSync Bridge 请求失败（HTTP ${status}）`);
    this.name = "BridgeHttpError";
    this.status = status;
    this.code = typeof details.error === "string" ? details.error : undefined;
    this.details = details;
  }
}

export class BridgeRevisionConflictError extends BridgeHttpError {
  readonly expectedRevision?: string;
  readonly actualRevision?: string;

  constructor(status: number, details: Record<string, unknown>) {
    super(status, details);
    this.name = "BridgeRevisionConflictError";
    this.expectedRevision =
      typeof details.expectedRevision === "string" ? details.expectedRevision : undefined;
    this.actualRevision =
      typeof details.actualRevision === "string" ? details.actualRevision : undefined;
  }
}

export class BridgeHttpClient implements NoteGateway {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: { baseUrl: string; token: string }) {
    this.baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.token = options.token;
  }

  private async request(path: string, body: unknown): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) {
      let details: Record<string, unknown> = {};
      try {
        const value: unknown = await response.json();
        if (value && typeof value === "object" && !Array.isArray(value)) {
          details = value as Record<string, unknown>;
        }
      } catch {
        // The status code remains sufficient for a safe public error.
      }
      if (response.status === 409 && details.error === "revision_conflict") {
        throw new BridgeRevisionConflictError(response.status, details);
      }
      throw new BridgeHttpError(response.status, details);
    }
    return response;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return (await this.request(path, body)).json() as Promise<T>;
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  readNote(path: string): Promise<NoteSnapshot> {
    return this.postJson("/v1/notes/read", { path });
  }

  commitNote(input: CommitNoteInput): Promise<CommitNoteResult> {
    return this.postJson("/v1/notes/commit", input);
  }

  listEntries(input: ListVaultEntriesInput): Promise<ListVaultEntriesResult> {
    return this.postJson("/v1/entries/list", input);
  }

  pollChanges(input: {
    since: string;
    limit?: number;
    timeoutMs?: number;
  }): Promise<VaultChangeBatch> {
    return this.postJson("/v1/changes/poll", input);
  }

  async readAttachment(path: string): Promise<AttachmentSnapshot> {
    const response = await this.request("/v1/attachments/read", { path });
    const revision = response.headers.get("x-mini-canvas-revision");
    const encodedPath = response.headers.get("x-mini-canvas-path");
    const ctime = Number(response.headers.get("x-mini-canvas-ctime"));
    const mtime = Number(response.headers.get("x-mini-canvas-mtime"));
    if (!revision || !encodedPath) throw new Error("Bridge 附件响应缺少元数据头");
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      path: decodeURIComponent(encodedPath),
      bytes,
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
      revision,
      ctime: Number.isFinite(ctime) ? ctime : 0,
      mtime: Number.isFinite(mtime) ? mtime : 0,
      size: bytes.byteLength,
    };
  }
}

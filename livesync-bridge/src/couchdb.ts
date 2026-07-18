type CouchDbErrorBody = {
  error?: string;
  reason?: string;
};

export type CouchDatabaseInfo = {
  update_seq: string | number;
};

export type CouchAllDocsRow<T> = {
  id: string;
  key: string;
  value: { rev: string; deleted?: boolean };
  doc?: T;
};

export type CouchAllDocsResult<T> = {
  rows: CouchAllDocsRow<T>[];
};

export type CouchChange<T> = {
  seq: string | number;
  id: string;
  changes: Array<{ rev: string }>;
  deleted?: boolean;
  doc?: T;
};

export type CouchChangesResult<T> = {
  results: CouchChange<T>[];
  last_seq: string | number;
  pending?: number;
};

export class CouchDbHttpError extends Error {
  readonly status: number;
  readonly errorCode?: string;

  constructor(status: number, body: CouchDbErrorBody, method: string, path: string) {
    super(
      `CouchDB ${method} ${path} 失败（HTTP ${status}${
        body.error ? `, ${body.error}` : ""
      }${body.reason ? `: ${body.reason}` : ""}）`,
    );
    this.name = "CouchDbHttpError";
    this.status = status;
    this.errorCode = body.error;
  }
}

function decodeUtf8(bytes: ArrayBuffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export class CouchDbClient {
  private readonly databaseUrl: string;
  private readonly authorization: string;

  constructor(options: {
    baseUrl: string;
    database: string;
    username: string;
    password: string;
  }) {
    this.databaseUrl = `${options.baseUrl.replace(/\/$/u, "")}/${encodeURIComponent(
      options.database,
    )}`;
    this.authorization = `Basic ${Buffer.from(
      `${options.username}:${options.password}`,
      "utf8",
    ).toString("base64")}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? "GET";
    const response = await fetch(`${this.databaseUrl}/${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: this.authorization,
        ...(init.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
        ...init.headers,
      },
    });
    const raw = decodeUtf8(await response.arrayBuffer());
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(`CouchDB 返回了无效的 UTF-8 JSON（HTTP ${response.status}）`);
      }
    }

    if (!response.ok) {
      throw new CouchDbHttpError(
        response.status,
        (body ?? {}) as CouchDbErrorBody,
        method,
        path,
      );
    }
    return body as T;
  }

  async getDocument<T>(id: string): Promise<T> {
    return this.request<T>(encodeURIComponent(id));
  }

  async getDocumentOrNull<T>(id: string): Promise<T | null> {
    try {
      return await this.getDocument<T>(id);
    } catch (error) {
      if (error instanceof CouchDbHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async putDocument<T extends { _id: string }>(
    document: T,
  ): Promise<{ ok: true; id: string; rev: string }> {
    return this.request(encodeURIComponent(document._id), {
      method: "PUT",
      body: JSON.stringify(document),
    });
  }

  async getLocalDocument<T>(id: string): Promise<T> {
    return this.request<T>(`_local/${encodeURIComponent(id)}`);
  }

  async getLocalDocumentOrNull<T>(id: string): Promise<T | null> {
    try {
      return await this.getLocalDocument<T>(id);
    } catch (error) {
      if (error instanceof CouchDbHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async putLocalDocument<T extends { _id: string }>(
    id: string,
    document: T,
  ): Promise<{ ok: true; id: string; rev: string }> {
    return this.request(`_local/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(document),
    });
  }

  async getDatabaseInfo(): Promise<CouchDatabaseInfo> {
    return this.request<CouchDatabaseInfo>("");
  }

  async listDocumentsPage<T>(
    afterId: string | undefined,
    limit: number,
  ): Promise<CouchAllDocsResult<T>> {
    const params = new URLSearchParams({
      include_docs: "true",
      limit: String(limit),
    });
    if (afterId !== undefined) {
      params.set("startkey", JSON.stringify(afterId));
      params.set("skip", "1");
    }
    return this.request<CouchAllDocsResult<T>>(`_all_docs?${params.toString()}`);
  }

  async pollChanges<T>(options: {
    since: string;
    limit: number;
    timeoutMs: number;
  }): Promise<CouchChangesResult<T>> {
    const params = new URLSearchParams({
      feed: "longpoll",
      include_docs: "true",
      since: options.since,
      limit: String(options.limit),
      timeout: String(options.timeoutMs),
    });
    return this.request<CouchChangesResult<T>>(`_changes?${params.toString()}`);
  }
}

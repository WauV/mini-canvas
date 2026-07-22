export {};

const couchDbUrl = required("COUCHDB_URL").replace(/\/$/u, "");
const username = required("COUCHDB_USER");
const password = required("COUCHDB_PASSWORD");
const database = required("COUCHDB_DATABASE");
const applicationUser = optionalPair(
  "COUCHDB_APP_USER",
  "COUCHDB_APP_PASSWORD",
);
const authorization = `Basic ${Buffer.from(
  `${username}:${password}`,
  "utf8",
).toString("base64")}`;

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`缺少配置项 ${key}`);
  return value;
}

function optionalPair(
  usernameKey: string,
  passwordKey: string,
): { username: string; password: string } | undefined {
  const pairUsername = process.env[usernameKey];
  const pairPassword = process.env[passwordKey];
  if (!pairUsername && !pairPassword) return undefined;
  if (!pairUsername || !pairPassword) {
    throw new Error(`${usernameKey} and ${passwordKey} must be configured together`);
  }
  return { username: pairUsername, password: pairPassword };
}

async function request(
  path: string,
  init: RequestInit = {},
  acceptedStatuses: number[] = [200, 201, 202],
): Promise<Response> {
  const response = await fetch(`${couchDbUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authorization,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(`CouchDB ${init.method ?? "GET"} ${path} 返回 HTTP ${response.status}`);
  }
  return response;
}

async function waitUntilReady(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await request("/_up");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error("CouchDB 在 60 秒内没有就绪", { cause: lastError });
}

async function ensureDatabase(name: string): Promise<void> {
  await request(`/${encodeURIComponent(name)}`, { method: "PUT" }, [201, 202, 412]);
}

async function setConfiguration(path: string, value: string): Promise<void> {
  await request(`/_node/_local/_config/${path}`, {
    method: "PUT",
    body: JSON.stringify(value),
  });
}

async function ensureApplicationUser(
  application: { username: string; password: string },
): Promise<void> {
  const documentId = `org.couchdb.user:${application.username}`;
  const path = `/_users/${encodeURIComponent(documentId)}`;
  const existing = await request(path, { method: "GET" }, [200, 404]);
  let revision: string | undefined;
  if (existing.status === 200) {
    const document = (await existing.json()) as { _rev?: unknown };
    if (typeof document._rev !== "string") {
      throw new Error("Existing CouchDB application user has no valid revision");
    }
    revision = document._rev;
  }
  await request(
    path,
    {
      method: "PUT",
      body: JSON.stringify({
        _id: documentId,
        ...(revision ? { _rev: revision } : {}),
        name: application.username,
        password: application.password,
        roles: [],
        type: "user",
      }),
    },
    [201, 202],
  );
  await request(`/${encodeURIComponent(database)}/_security`, {
    method: "PUT",
    body: JSON.stringify({
      admins: { names: [], roles: [] },
      members: { names: [application.username], roles: [] },
    }),
  });
}

async function main(): Promise<void> {
  await waitUntilReady();
  for (const name of ["_users", "_replicator", "_global_changes", database]) {
    await ensureDatabase(name);
  }

  const configuration: Array<[string, string]> = [
    ["httpd/WWW-Authenticate", 'Basic realm="couchdb"'],
    ["chttpd/enable_cors", "true"],
    ["chttpd/max_http_request_size", "4294967296"],
    ["couchdb/max_document_size", "50000000"],
    ["cors/credentials", "true"],
    [
      "cors/origins",
      "app://obsidian.md, capacitor://localhost, http://localhost",
    ],
    ["cors/headers", "accept, authorization, content-type, origin, referer"],
    ["cors/methods", "GET, PUT, POST, HEAD, DELETE"],
    ["cors/max_age", "3600"],
    ["chttpd/require_valid_user", "true"],
  ];
  for (const [path, value] of configuration) {
    await setConfiguration(path, value);
  }
  if (applicationUser) {
    await ensureApplicationUser(applicationUser);
  }
  process.stdout.write(`CouchDB database is ready: ${database}\n`);
}

await main();

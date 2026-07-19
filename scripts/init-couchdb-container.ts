export {};

const couchDbUrl = required("COUCHDB_URL").replace(/\/$/u, "");
const username = required("COUCHDB_USER");
const password = required("COUCHDB_PASSWORD");
const database = required("COUCHDB_DATABASE");
const authorization = `Basic ${Buffer.from(
  `${username}:${password}`,
  "utf8",
).toString("base64")}`;

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`缺少配置项 ${key}`);
  return value;
}

async function request(
  path: string,
  init: RequestInit = {},
  acceptedStatuses: number[] = [200, 201, 202],
): Promise<void> {
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
  process.stdout.write(`CouchDB database is ready: ${database}\n`);
}

await main();

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BridgeConfig = {
  couchDbUrl: string;
  database: string;
  username: string;
  password: string;
  passphrase: string;
  caseInsensitive: boolean;
};

export type BridgeServerConfig = BridgeConfig & {
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  authToken: string;
  maxAttachmentBytes: number;
};

function parseEnvFile(path: string, optional = false): Record<string, string> {
  const values: Record<string, string> = {};

  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (
      optional &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return values;
    }
    throw error;
  }

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new Error(`环境文件格式错误：${path}`);
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function processEnvironment(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) values[key] = value;
  }
  return values;
}

function parseListenHost(
  value: string | undefined,
): "127.0.0.1" | "0.0.0.0" {
  const host = value ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new Error("LIVESYNC_BRIDGE_HOST 必须是 127.0.0.1 或 0.0.0.0");
  }
  return host;
}

function parseCouchDbUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("COUCHDB_URL 必须是没有凭据和路径的 HTTP(S) 地址");
  }
  return url.toString().replace(/\/$/u, "");
}

function requireValue(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value) throw new Error(`缺少配置项 ${key}`);
  return value;
}

export function projectRootFromModule(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function loadBridgeConfig(projectRoot = projectRootFromModule()): BridgeConfig {
  const environment = processEnvironment();
  const couch = {
    ...parseEnvFile(resolve(projectRoot, ".local", "couchdb.env"), true),
    ...environment,
  };
  const liveSync = {
    ...parseEnvFile(
      resolve(projectRoot, ".local", "livesync-bridge.env"),
      true,
    ),
    ...environment,
  };
  const couchDbUrl = couch.COUCHDB_URL
    ? parseCouchDbUrl(couch.COUCHDB_URL)
    : parseCouchDbUrl(
        `http://127.0.0.1:${requireValue(couch, "COUCHDB_PORT")}`,
      );

  return {
    couchDbUrl,
    database: requireValue(couch, "COUCHDB_DATABASE"),
    username: requireValue(couch, "COUCHDB_USER"),
    password: requireValue(couch, "COUCHDB_PASSWORD"),
    passphrase: requireValue(liveSync, "LIVESYNC_PASSPHRASE"),
    caseInsensitive:
      (liveSync.LIVESYNC_CASE_INSENSITIVE ?? "false").toLowerCase() === "true",
  };
}

export function loadBridgeServerConfig(
  projectRoot = projectRootFromModule(),
): BridgeServerConfig {
  const liveSync = {
    ...parseEnvFile(
      resolve(projectRoot, ".local", "livesync-bridge.env"),
      true,
    ),
    ...processEnvironment(),
  };
  const port = Number(liveSync.LIVESYNC_BRIDGE_PORT ?? "3210");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LIVESYNC_BRIDGE_PORT 必须是 1 到 65535 之间的整数");
  }
  const maxAttachmentBytes = Number(
    liveSync.LIVESYNC_BRIDGE_MAX_ATTACHMENT_BYTES ?? String(20 * 1024 * 1024),
  );
  if (!Number.isInteger(maxAttachmentBytes) || maxAttachmentBytes < 1) {
    throw new Error("LIVESYNC_BRIDGE_MAX_ATTACHMENT_BYTES 必须是正整数");
  }

  return {
    ...loadBridgeConfig(projectRoot),
    host: parseListenHost(liveSync.LIVESYNC_BRIDGE_HOST),
    port,
    authToken: requireValue(liveSync, "LIVESYNC_BRIDGE_TOKEN"),
    maxAttachmentBytes,
  };
}

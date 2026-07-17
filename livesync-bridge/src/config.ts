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
  host: "127.0.0.1";
  port: number;
  authToken: string;
};

function parseEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
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

function requireValue(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value) throw new Error(`缺少配置项 ${key}`);
  return value;
}

export function projectRootFromModule(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function loadBridgeConfig(projectRoot = projectRootFromModule()): BridgeConfig {
  const couch = parseEnvFile(resolve(projectRoot, ".local", "couchdb.env"));
  const liveSync = parseEnvFile(
    resolve(projectRoot, ".local", "livesync-bridge.env"),
  );
  const port = requireValue(couch, "COUCHDB_PORT");

  return {
    couchDbUrl: `http://127.0.0.1:${port}`,
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
  const liveSync = parseEnvFile(
    resolve(projectRoot, ".local", "livesync-bridge.env"),
  );
  const port = Number(liveSync.LIVESYNC_BRIDGE_PORT ?? "3210");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LIVESYNC_BRIDGE_PORT 必须是 1 到 65535 之间的整数");
  }

  return {
    ...loadBridgeConfig(projectRoot),
    host: "127.0.0.1",
    port,
    authToken: requireValue(liveSync, "LIVESYNC_BRIDGE_TOKEN"),
  };
}

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { StaticTokenRecord } from "./auth.ts";
import { MCP_SCOPES, type McpScope, type Principal } from "./types.ts";

export type McpConfig = {
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  allowedHosts: string[];
  databasePath: string;
  masterKey: Buffer;
  tokens: StaticTokenRecord[];
  bridgeUrl: string;
  bridgeToken: string;
  autoIndex: boolean;
  caseInsensitivePaths: boolean;
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
    if (separator < 1) throw new Error(`环境文件格式错误：${path}`);
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
    throw new Error("MINI_CANVAS_MCP_HOST 必须是 127.0.0.1 或 0.0.0.0");
  }
  return host;
}

function parseAllowedHosts(
  value: string | undefined,
  host: "127.0.0.1" | "0.0.0.0",
): string[] {
  if (!value) {
    if (host === "0.0.0.0") {
      throw new Error(
        "MINI_CANVAS_MCP_HOST=0.0.0.0 时必须配置 MINI_CANVAS_MCP_ALLOWED_HOSTS",
      );
    }
    return ["127.0.0.1", "localhost", "[::1]"];
  }
  const allowedHosts = [...new Set(value.split(",").map((item) => item.trim()))]
    .filter(Boolean);
  if (
    allowedHosts.length === 0 ||
    allowedHosts.some((item) =>
      item.startsWith("[") && item.endsWith("]")
        ? !/^\[[0-9a-f:]+\]$/iu.test(item)
        : !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/iu.test(item),
    )
  ) {
    throw new Error("MINI_CANVAS_MCP_ALLOWED_HOSTS 必须是逗号分隔且不含端口的主机名");
  }
  return allowedHosts;
}

function parseBridgeUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("MINI_CANVAS_BRIDGE_URL 必须是没有凭据的 HTTP(S) 地址");
  }
  return url.toString().replace(/\/$/u, "");
}

function requireValue(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value) throw new Error(`缺少配置项 ${key}`);
  return value;
}

function parseTokens(raw: string): StaticTokenRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("MINI_CANVAS_MCP_AUTH_JSON 不是有效 JSON");
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("MINI_CANVAS_MCP_AUTH_JSON 必须是非空数组");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`MCP 身份记录 ${index} 必须是对象`);
    }
    const record = item as Partial<StaticTokenRecord>;
    if (
      typeof record.token !== "string" ||
      typeof record.userId !== "string" ||
      !Array.isArray(record.scopes) ||
      !record.scopes.every(
        (scope) => typeof scope === "string" && MCP_SCOPES.includes(scope as McpScope),
      ) ||
      !Array.isArray(record.allowedPaths) ||
      !record.allowedPaths.every((path) => typeof path === "string")
    ) {
      throw new Error(`MCP 身份记录 ${index} 字段无效`);
    }
    const principal: Principal = {
      userId: record.userId,
      scopes: record.scopes as McpScope[],
      allowedPaths: record.allowedPaths,
    };
    return { token: record.token, ...principal };
  });
}

export function projectRootFromMcpModule(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function loadMcpConfig(projectRoot = projectRootFromMcpModule()): McpConfig {
  const values = {
    ...parseEnvFile(resolve(projectRoot, ".local", "mcp-server.env"), true),
    ...processEnvironment(),
  };
  const port = Number(values.MINI_CANVAS_MCP_PORT ?? "3220");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MINI_CANVAS_MCP_PORT 必须是 1 到 65535 之间的整数");
  }
  const databaseSetting = values.MINI_CANVAS_MCP_DB ?? ".local/mcp-server.sqlite";
  const databasePath = isAbsolute(databaseSetting)
    ? databaseSetting
    : resolve(projectRoot, databaseSetting);
  const masterKey = Buffer.from(
    requireValue(values, "MINI_CANVAS_MCP_MASTER_KEY_BASE64"),
    "base64",
  );
  if (masterKey.byteLength !== 32) {
    throw new Error("MINI_CANVAS_MCP_MASTER_KEY_BASE64 解码后必须是 32 bytes");
  }
  const bridgeUrl = parseBridgeUrl(
    requireValue(values, "MINI_CANVAS_BRIDGE_URL"),
  );
  const host = parseListenHost(values.MINI_CANVAS_MCP_HOST);
  return {
    host,
    port,
    allowedHosts: parseAllowedHosts(
      values.MINI_CANVAS_MCP_ALLOWED_HOSTS,
      host,
    ),
    databasePath,
    masterKey,
    tokens: parseTokens(requireValue(values, "MINI_CANVAS_MCP_AUTH_JSON")),
    bridgeUrl,
    bridgeToken: requireValue(values, "MINI_CANVAS_BRIDGE_TOKEN"),
    autoIndex: (values.MINI_CANVAS_MCP_AUTO_INDEX ?? "true").toLowerCase() === "true",
    caseInsensitivePaths:
      (values.MINI_CANVAS_VAULT_CASE_INSENSITIVE ?? "true").toLowerCase() === "true",
  };
}

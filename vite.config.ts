import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

function loadLocalMcpProxyEnvironment(): Record<string, string> | undefined {
  const path = resolve(process.cwd(), ".local", "mcp-server.env");
  if (!existsSync(path)) return undefined;

  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
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

  const port = values.MINI_CANVAS_MCP_PORT ?? "3220";
  process.env.MINI_CANVAS_LOCAL_MCP_URL ??= `http://127.0.0.1:${port}/mcp`;
  if (!process.env.MINI_CANVAS_LOCAL_MCP_TOKEN) {
    try {
      const records = JSON.parse(values.MINI_CANVAS_MCP_AUTH_JSON ?? "[]") as Array<{
        token?: unknown;
      }>;
      const token = records[0]?.token;
      if (typeof token === "string") {
        process.env.MINI_CANVAS_LOCAL_MCP_TOKEN = token;
      }
    } catch {
      // The MCP server will report its own configuration error. Never expose the
      // malformed authentication record to the browser build.
    }
  }

  const url = process.env.MINI_CANVAS_LOCAL_MCP_URL;
  const token = process.env.MINI_CANVAS_LOCAL_MCP_TOKEN;
  if (!url || !token) return undefined;
  return {
    MINI_CANVAS_LOCAL_MCP_URL: url,
    MINI_CANVAS_LOCAL_MCP_TOKEN: token,
  };
}

export default defineConfig(async ({ command }) => {
  const localMcpProxyEnvironment =
    command === "serve" ? loadLocalMcpProxyEnvironment() : undefined;
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
          d1_databases: d1
            ? [
                {
                  binding: d1,
                  database_name: "site-creator-d1",
                  database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
                },
              ]
            : [],
          r2_buckets: r2
            ? [
                {
                  binding: r2,
                  bucket_name: "site-creator-r2",
                },
              ]
            : [],
          ...(localMcpProxyEnvironment
            ? { vars: localMcpProxyEnvironment }
            : {}),
        },
      }),
    ],
  };
});

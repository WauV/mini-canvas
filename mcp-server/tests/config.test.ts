import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadMcpConfig } from "../src/config.ts";

const CONTAINER_KEYS = [
  "MINI_CANVAS_MCP_HOST",
  "MINI_CANVAS_MCP_ALLOWED_HOSTS",
  "MINI_CANVAS_MCP_PORT",
  "MINI_CANVAS_MCP_DB",
  "MINI_CANVAS_MCP_MASTER_KEY_BASE64",
  "MINI_CANVAS_MCP_AUTH_JSON",
  "MINI_CANVAS_BRIDGE_URL",
  "MINI_CANVAS_BRIDGE_TOKEN",
  "MINI_CANVAS_MCP_AUTO_INDEX",
  "MINI_CANVAS_VAULT_CASE_INSENSITIVE",
  "MINI_CANVAS_MCP_DRAFT_RETENTION_DAYS",
  "MINI_CANVAS_DEFAULT_TENANT_ID",
] as const;

function withContainerEnvironment(callback: () => void): void {
  const previous = new Map(
    CONTAINER_KEYS.map((key) => [key, process.env[key]] as const),
  );
  Object.assign(process.env, {
    MINI_CANVAS_MCP_HOST: "0.0.0.0",
    MINI_CANVAS_MCP_ALLOWED_HOSTS: "127.0.0.1,localhost,mcp-server",
    MINI_CANVAS_MCP_PORT: "3220",
    MINI_CANVAS_MCP_DB: "/data/mcp-server.sqlite",
    MINI_CANVAS_MCP_MASTER_KEY_BASE64: Buffer.alloc(32, 9).toString("base64"),
    MINI_CANVAS_MCP_AUTH_JSON: JSON.stringify([
      {
        token: "t".repeat(40),
        userId: "container-user",
        scopes: ["notes:read", "vault:list"],
        allowedPaths: [""],
        expiresAt: 1_893_456_000,
      },
    ]),
    MINI_CANVAS_BRIDGE_URL: "http://livesync-bridge:3210",
    MINI_CANVAS_BRIDGE_TOKEN: "b".repeat(40),
    MINI_CANVAS_MCP_AUTO_INDEX: "true",
    MINI_CANVAS_VAULT_CASE_INSENSITIVE: "true",
    MINI_CANVAS_MCP_DRAFT_RETENTION_DAYS: "30",
    MINI_CANVAS_DEFAULT_TENANT_ID: "container-vault",
  });
  try {
    callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("loads MCP configuration entirely from container environment", () => {
  withContainerEnvironment(() => {
    const config = loadMcpConfig(
      join(tmpdir(), "mini-canvas-mcp-config-without-local-files"),
    );
    assert.equal(config.host, "0.0.0.0");
    assert.deepEqual(config.allowedHosts, ["127.0.0.1", "localhost", "mcp-server"]);
    assert.equal(config.bridgeUrl, "http://livesync-bridge:3210");
    assert.equal(config.databasePath, "/data/mcp-server.sqlite");
    assert.equal(config.tokens[0].userId, "container-user");
    assert.equal(config.tokens[0].tenantId, "container-vault");
    assert.equal(config.defaultTenantId, "container-vault");
    assert.equal(config.tokens[0].expiresAt, 1_893_456_000);
    assert.equal(config.draftRetentionDays, 30);
  });
});

test("requires DNS rebinding protection when binding MCP to all interfaces", () => {
  withContainerEnvironment(() => {
    delete process.env.MINI_CANVAS_MCP_ALLOWED_HOSTS;
    assert.throws(
      () =>
        loadMcpConfig(
          join(tmpdir(), "mini-canvas-mcp-config-without-local-files"),
        ),
      /必须配置 MINI_CANVAS_MCP_ALLOWED_HOSTS/u,
    );
  });
});

test("rejects credentials embedded in the Bridge URL", () => {
  withContainerEnvironment(() => {
    process.env.MINI_CANVAS_BRIDGE_URL =
      "http://user:password@livesync-bridge:3210";
    assert.throws(
      () =>
        loadMcpConfig(
          join(tmpdir(), "mini-canvas-mcp-config-without-local-files"),
        ),
      /没有凭据/u,
    );
  });
});

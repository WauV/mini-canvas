import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const root = process.cwd();
const compose = readFileSync(
  resolve(root, "docker-compose.server.yml"),
  "utf8",
);
const caddy = readFileSync(resolve(root, "deploy", "Caddyfile"), "utf8");
const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8");
const dockerignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
const initScript = readFileSync(
  resolve(root, "deploy", "scripts", "init-production.sh"),
  "utf8",
);

function serviceBlock(name: string): string {
  const startMarker = `  ${name}:\n`;
  const start = compose.indexOf(startMarker);
  assert.notEqual(start, -1, `missing service ${name}`);
  const rest = compose.slice(start + startMarker.length);
  const next = rest.search(/^  [a-z][a-z0-9-]*:\n/mu);
  return next < 0 ? rest : rest.slice(0, next);
}

test("publishes only the hardened production reverse proxy", () => {
  for (const service of ["couchdb", "livesync-bridge", "mcp-server"]) {
    assert.doesNotMatch(serviceBlock(service), /^    ports:/mu);
  }
  const proxy = serviceBlock("caddy");
  assert.match(proxy, /"80:80"/u);
  assert.match(proxy, /"443:443"/u);
  assert.match(proxy, /NET_BIND_SERVICE/u);
  assert.match(proxy, /no-new-privileges:true/u);
});

test("keeps CouchDB and MCP on segmented production networks", () => {
  const couchdb = serviceBlock("couchdb");
  const bridge = serviceBlock("livesync-bridge");
  const mcp = serviceBlock("mcp-server");
  const proxy = serviceBlock("caddy");

  assert.match(couchdb, /couchdb-edge/u);
  assert.match(couchdb, /couchdb-bridge/u);
  assert.doesNotMatch(couchdb, /mcp-edge/u);
  assert.match(bridge, /couchdb-bridge/u);
  assert.match(bridge, /bridge-mcp/u);
  assert.match(mcp, /bridge-mcp/u);
  assert.match(mcp, /mcp-edge/u);
  assert.doesNotMatch(mcp, /couchdb-bridge/u);
  assert.match(proxy, /couchdb-edge/u);
  assert.match(proxy, /mcp-edge/u);
  assert.match(proxy, /public-edge/u);
});

test("blocks public administration surfaces and ignores generated secrets", () => {
  assert.match(caddy, /\/_node\/\*/u);
  assert.match(caddy, /\/_cluster_setup\*/u);
  assert.match(caddy, /@internalHealth path \/health/u);
  assert.match(gitignore, /\/deploy\/production\/secrets\//u);
  assert.match(gitignore, /\/deploy\/production\/\.env/u);
  assert.match(dockerignore, /^deploy$/mu);
  assert.match(dockerignore, /^backups$/mu);
  assert.match(initScript, /umask 077/u);
  assert.match(initScript, /Refusing to overwrite/u);
  assert.doesNotMatch(initScript, /echo "\$mcp_token"/u);
});

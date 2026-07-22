import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadBridgeServerConfig } from "../src/config.ts";

const CONTAINER_KEYS = [
  "COUCHDB_URL",
  "COUCHDB_DATABASE",
  "COUCHDB_USER",
  "COUCHDB_PASSWORD",
  "COUCHDB_APP_USER",
  "COUCHDB_APP_PASSWORD",
  "LIVESYNC_PASSPHRASE",
  "LIVESYNC_CASE_INSENSITIVE",
  "LIVESYNC_BRIDGE_HOST",
  "LIVESYNC_BRIDGE_PORT",
  "LIVESYNC_BRIDGE_TOKEN",
  "LIVESYNC_BRIDGE_MAX_ATTACHMENT_BYTES",
] as const;

function withContainerEnvironment(callback: () => void): void {
  const previous = new Map(
    CONTAINER_KEYS.map((key) => [key, process.env[key]] as const),
  );
  Object.assign(process.env, {
    COUCHDB_URL: "http://couchdb-test:5984",
    COUCHDB_DATABASE: "mini_canvas_test",
    COUCHDB_USER: "tester",
    COUCHDB_PASSWORD: "container-password",
    LIVESYNC_PASSPHRASE: "container-passphrase",
    LIVESYNC_CASE_INSENSITIVE: "true",
    LIVESYNC_BRIDGE_HOST: "0.0.0.0",
    LIVESYNC_BRIDGE_PORT: "3210",
    LIVESYNC_BRIDGE_TOKEN: "b".repeat(40),
    LIVESYNC_BRIDGE_MAX_ATTACHMENT_BYTES: "20971520",
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

test("loads Bridge configuration entirely from container environment", () => {
  withContainerEnvironment(() => {
    const config = loadBridgeServerConfig(
      join(tmpdir(), "mini-canvas-config-without-local-files"),
    );
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.couchDbUrl, "http://couchdb-test:5984");
    assert.equal(config.database, "mini_canvas_test");
    assert.equal(config.caseInsensitive, true);
  });
});

test("prefers a non-admin CouchDB application account when provided", () => {
  withContainerEnvironment(() => {
    process.env.COUCHDB_APP_USER = "mini-canvas-sync";
    process.env.COUCHDB_APP_PASSWORD = "application-password";
    const config = loadBridgeServerConfig(
      join(tmpdir(), "mini-canvas-config-with-application-user"),
    );
    assert.equal(config.username, "mini-canvas-sync");
    assert.equal(config.password, "application-password");
  });
});

test("rejects an unsafe Bridge listen host", () => {
  withContainerEnvironment(() => {
    process.env.LIVESYNC_BRIDGE_HOST = "192.168.1.10";
    assert.throws(
      () =>
        loadBridgeServerConfig(
          join(tmpdir(), "mini-canvas-config-without-local-files"),
        ),
      /LIVESYNC_BRIDGE_HOST/u,
    );
  });
});

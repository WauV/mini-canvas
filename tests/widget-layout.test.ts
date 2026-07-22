import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "app", "globals.css"), "utf8");
const toolClient = readFileSync(
  resolve(process.cwd(), "app", "lib", "mcp", "tool-client.ts"),
  "utf8",
);

test("keeps the inline Widget finite instead of feeding iframe auto-resize", () => {
  assert.match(
    styles,
    /\.canvas-shell\.is-widget\s*\{[^}]*min-height:\s*0;[^}]*height:\s*auto;/su,
  );
  assert.match(
    styles,
    /\.is-widget \.workspace\s*\{[^}]*height:\s*560px;[^}]*min-height:\s*0;/su,
  );
  assert.doesNotMatch(
    styles,
    /\.is-widget \.workspace\s*\{[^}]*100dvh/su,
  );
});

test("reports the inline Widget size once without an automatic observer", () => {
  assert.match(toolClient, /autoResize:\s*false/u);
  assert.doesNotMatch(toolClient, /autoResize:\s*true/u);
  assert.match(toolClient, /sendSizeChanged\(\{ height \}\)/u);
});

test("lets the MCP Apps SDK negotiate ChatGPT and Claude host transports", () => {
  assert.doesNotMatch(toolClient, /PostMessageTransport/u);
  assert.match(toolClient, /this\.app\.connect\(\)/u);
});

import assert from "node:assert/strict";
import { test } from "vitest";

import type { EmbedResolutionRequest } from "../app/lib/obsidian-interactions.ts";
import { MiniCanvasMcpClient } from "../app/lib/mcp/mini-canvas-client.ts";
import { VaultInteractionResolver } from "../app/lib/mcp/vault-interaction-resolver.ts";
import type { McpToolClient, McpToolResult } from "../app/lib/mcp/tool-client.ts";

const entries = [
  {
    path: "Notes/Current.md",
    kind: "note",
    mimeType: "text/markdown",
    revision: "1-current",
    ctime: 1,
    mtime: 1,
    size: 10,
  },
  {
    path: "Notes/Target.md",
    kind: "note",
    mimeType: "text/markdown",
    revision: "1-target",
    ctime: 1,
    mtime: 1,
    size: 10,
  },
  {
    path: "Assets/photo.png",
    kind: "attachment",
    mimeType: "image/png",
    revision: "2-photo",
    ctime: 1,
    mtime: 2,
    size: 2,
  },
  {
    path: "Assets/diagram.svg",
    kind: "attachment",
    mimeType: "image/svg+xml",
    revision: "3-svg",
    ctime: 1,
    mtime: 3,
    size: 7,
  },
] as const;

function request(path: string): EmbedResolutionRequest {
  return { target: path, path, subpath: "", label: path };
}

class ResolverTools implements McpToolClient {
  listCalls = 0;
  readCalls = 0;

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<McpToolResult> {
    if (name === "list_entries") {
      this.listCalls += 1;
      return { structuredContent: { entries } };
    }
    assert.equal(name, "read_attachment");
    this.readCalls += 1;
    const path = String(arguments_.path);
    if (path.endsWith(".svg")) {
      return {
        structuredContent: {
          ...entries[3],
          delivery: "text",
          text: "<svg />",
        },
      };
    }
    return {
      structuredContent: { ...entries[2], delivery: "image" },
      content: [{ type: "image", data: "aGk=", mimeType: "image/png" }],
    };
  }
}

test("resolves and caches image and SVG attachment content", async () => {
  const tools = new ResolverTools();
  const resolver = new VaultInteractionResolver(
    () => new MiniCanvasMcpClient(tools),
  );

  const first = await resolver.resolveEmbed(request("photo.png"), "Notes/Current.md");
  const second = await resolver.resolveEmbed(request("photo.png"), "Notes/Current.md");
  assert.equal(first.kind, "image");
  assert.equal(first.kind === "image" ? first.source : "", "data:image/png;base64,aGk=");
  assert.deepEqual(second, first);
  assert.equal(tools.listCalls, 1);
  assert.equal(tools.readCalls, 1);

  const svg = await resolver.resolveEmbed(request("diagram.svg"));
  assert.equal(svg.kind, "svg");
  assert.equal(tools.readCalls, 2);
});

test("resolves note embeds and Wiki navigation without reading attachments", async () => {
  const tools = new ResolverTools();
  const resolver = new VaultInteractionResolver(
    () => new MiniCanvasMcpClient(tools),
  );

  assert.deepEqual(
    await resolver.resolveEmbed(request("Target"), "Notes/Current.md"),
    { kind: "note", path: "Notes/Target.md" },
  );
  assert.equal(
    await resolver.resolveWikiLink(
      { target: "Target", path: "Target", subpath: "", label: "Target" },
      "Notes/Current.md",
    ),
    "Notes/Target.md",
  );
  assert.equal(tools.readCalls, 0);
  resolver.clear();
  await resolver.resolveWikiLink(
    { target: "Target", path: "Target", subpath: "", label: "Target" },
    "Notes/Current.md",
  );
  assert.equal(tools.listCalls, 2);
});

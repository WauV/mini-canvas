import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const MINI_CANVAS_WIDGET_URI = "ui://mini-canvas/editor-v1.html";

const widgetResourceMeta = {
  ui: {
    prefersBorder: false,
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
};

function projectRoot(): string {
  return resolve(import.meta.dirname, "..", "..");
}

function safeInlineScript(source: string): string {
  return source.replace(/<\/script/giu, "<\\/script");
}

function safeInlineStyle(source: string): string {
  return source.replace(/<\/style/giu, "<\\/style");
}

export async function loadMiniCanvasWidgetHtml(): Promise<string> {
  const outputDirectory = resolve(projectRoot(), "mcp-server", "widget-dist");
  let script: string;
  let style: string;
  try {
    [script, style] = await Promise.all([
      readFile(resolve(outputDirectory, "mini-canvas-widget.js"), "utf8"),
      readFile(resolve(outputDirectory, "mini-canvas-widget.css"), "utf8"),
    ]);
  } catch (error) {
    throw new Error(
      "Mini Canvas Widget 尚未构建；请先运行 npm run widget:build",
      { cause: error },
    );
  }

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    "<title>Mini Canvas</title>",
    `<style>${safeInlineStyle(style)}</style>`,
    "</head>",
    "<body>",
    '<div id="mini-canvas-root"></div>',
    `<script type="module">${safeInlineScript(script)}</script>`,
    "</body>",
    "</html>",
  ].join("");
}

export function registerMiniCanvasWidget(server: McpServer): void {
  registerAppResource(
    server,
    "Mini Canvas editor",
    MINI_CANVAS_WIDGET_URI,
    {
      description:
        "Interactive Obsidian Markdown, LaTeX and encrypted draft editor.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: widgetResourceMeta,
    },
    async () => ({
      contents: [
        {
          uri: MINI_CANVAS_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadMiniCanvasWidgetHtml(),
          _meta: widgetResourceMeta,
        },
      ],
    }),
  );
}

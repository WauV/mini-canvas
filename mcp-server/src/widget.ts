import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// The resource URI is also the host-side cache key. Bump it whenever the
// inlined Widget bundle changes so ChatGPT cannot reuse stale HTML.
export const MINI_CANVAS_WIDGET_URI = "ui://mini-canvas/editor-v11.html";
const MINI_CANVAS_WIDGET_LEGACY_URIS = [
  "ui://mini-canvas/editor-v1.html",
  "ui://mini-canvas/editor-v2.html",
  "ui://mini-canvas/editor-v3.html",
  "ui://mini-canvas/editor-v4.html",
  "ui://mini-canvas/editor-v5.html",
  "ui://mini-canvas/editor-v6.html",
  "ui://mini-canvas/editor-v7.html",
  "ui://mini-canvas/editor-v8.html",
  "ui://mini-canvas/editor-v9.html",
  "ui://mini-canvas/editor-v10.html",
] as const;

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

function compressedScriptBootstrap(source: string): string {
  const compressed = gzipSync(Buffer.from(source, "utf8"), { level: 9 }).toString(
    "base64",
  );
  return [
    "(async()=>{",
    'const root=document.getElementById("mini-canvas-root");',
    "try{",
    'if(typeof DecompressionStream!=="function")throw new Error("当前浏览器不支持 Widget 解压缩");',
    `const encoded=${JSON.stringify(compressed)};`,
    "const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));",
    'const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));',
    "const source=await new Response(stream).text();",
    'const script=document.createElement("script");',
    "script.textContent=source;",
    "document.head.appendChild(script);",
    "}catch(error){",
    'console.error("Mini Canvas Widget bootstrap failed",error);',
    'if(root)root.innerHTML="<div class=\\"widget-bootstrap widget-bootstrap-error\\" role=\\"alert\\">Mini Canvas 启动失败，请重新打开应用。</div>";',
    "}",
    "})();",
  ].join("");
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
    '<div id="mini-canvas-root"><div class="widget-bootstrap" role="status">正在启动 Mini Canvas…</div></div>',
    `<script>${safeInlineScript(compressedScriptBootstrap(script))}</script>`,
    "</body>",
    "</html>",
  ].join("");
}

export function registerMiniCanvasWidget(server: McpServer): void {
  const resourceUris = [
    MINI_CANVAS_WIDGET_URI,
    ...MINI_CANVAS_WIDGET_LEGACY_URIS,
  ];
  for (const [index, resourceUri] of resourceUris.entries()) {
    registerAppResource(
      server,
      index === 0 ? "Mini Canvas editor" : `Mini Canvas editor legacy ${index}`,
      resourceUri,
      {
        description:
          "Interactive Obsidian Markdown, LaTeX and encrypted draft editor.",
        mimeType: RESOURCE_MIME_TYPE,
        _meta: widgetResourceMeta,
      },
      async () => ({
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: await loadMiniCanvasWidgetHtml(),
            _meta: widgetResourceMeta,
          },
        ],
      }),
    );
  }
}

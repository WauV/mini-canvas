import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [
    react(),
    {
      name: "mini-canvas-embed-katex-woff2-only",
      enforce: "pre",
      transform(source, id) {
        if (!id.replaceAll("\\", "/").endsWith("/katex/dist/katex.min.css")) {
          return null;
        }

        // KaTeX relies on its own metrics-compatible fonts for delimiters,
        // roots, operators and script faces. Removing every @font-face makes
        // the Widget fall back to host fonts and visibly breaks formulas.
        // Keep one modern WOFF2 source per face while dropping the duplicate
        // WOFF and TTF fallbacks. Vite then inlines these files into the
        // self-contained Widget stylesheet.
        return source.replace(/@font-face\s*\{[^{}]*\}/gu, (fontFace) =>
          fontFace.replace(
            /src\s*:\s*url\(([^)]*\.woff2)\)\s*format\(["']woff2["']\)[^}]*/u,
            'src:url($1) format("woff2");',
          ),
        );
      },
    },
  ],
  build: {
    outDir: "mcp-server/widget-dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: true,
    assetsInlineLimit: 100_000_000,
    lib: {
      entry: resolve(import.meta.dirname, "widget/main.tsx"),
      // Vite deliberately keeps whitespace in ES library output because
      // removing pure annotations can affect downstream tree-shaking. The
      // Widget is a final, self-contained browser artifact, so IIFE output is
      // the correct target and lets Oxc fully minify the template payload.
      formats: ["iife"],
      name: "MiniCanvasWidget",
      fileName: () => "mini-canvas-widget.js",
    },
    rolldownOptions: {
      output: {
        codeSplitting: false,
        assetFileNames: (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith(".css"))
            ? "mini-canvas-widget.css"
            : "mini-canvas-widget.[ext]",
      },
    },
  },
});

import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "mcp-server/widget-dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    lib: {
      entry: resolve(import.meta.dirname, "widget/main.tsx"),
      formats: ["es"],
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

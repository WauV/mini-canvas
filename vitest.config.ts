import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/frontend/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: [
        "app/MiniCanvas.tsx",
        "app/components/**/*.tsx",
        "app/lib/**/*.ts",
      ],
      exclude: ["app/lib/mcp/tool-client.ts"],
      thresholds: {
        statements: 90,
        branches: 84,
        functions: 86,
        lines: 91,
        "app/lib/editor-actions.ts": {
          statements: 99,
          branches: 95,
          functions: 100,
          lines: 99,
        },
        "app/lib/live-preview.ts": {
          statements: 90,
          branches: 84,
          functions: 70,
          lines: 90,
        },
        "app/lib/obsidian-markdown.ts": {
          statements: 99,
          branches: 90,
          functions: 100,
          lines: 99,
        },
        "app/lib/svg-preview.ts": {
          statements: 94,
          branches: 94,
          functions: 100,
          lines: 94,
        },
        "app/lib/mcp/mini-canvas-client.ts": {
          statements: 94,
          branches: 89,
          functions: 100,
          lines: 94,
        },
      },
    },
  },
});

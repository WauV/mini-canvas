import { loadMcpConfig } from "./config.ts";
import { createMcpRuntime } from "./runtime.ts";
import { startMcpHttpServer } from "./server.ts";

async function closeServer(server: import("node:http").Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  const config = loadMcpConfig();
  const runtime = createMcpRuntime(config);
  const cleanupDrafts = () => {
    try {
      const result = runtime.drafts.cleanupExpired(
        Date.now(),
        config.draftRetentionDays * 24 * 60 * 60 * 1_000,
      );
      if (result.markedExpired > 0 || result.deleted > 0) {
        console.log(
          `Mini Canvas drafts cleaned: expired=${result.markedExpired}, deleted=${result.deleted}`,
        );
      }
    } catch (error) {
      console.error("Mini Canvas draft cleanup failed", error);
    }
  };
  cleanupDrafts();

  if (command === "index") {
    await runtime.search.refresh(process.argv.includes("--rebuild"));
    console.log("Mini Canvas search index is ready");
    runtime.database.close();
    return;
  }
  if (command !== "serve") {
    runtime.database.close();
    throw new Error("用法：cli.ts serve；或 cli.ts index [--rebuild]");
  }

  await runtime.search.start(config.autoIndex);
  const server = await startMcpHttpServer(config, runtime);
  console.log(`Mini Canvas MCP listening on http://${config.host}:${config.port}/mcp`);
  const draftCleanupTimer = setInterval(cleanupDrafts, 6 * 60 * 60 * 1_000);
  draftCleanupTimer.unref();

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    clearInterval(draftCleanupTimer);
    await closeServer(server);
    await runtime.search.stop();
    runtime.database.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

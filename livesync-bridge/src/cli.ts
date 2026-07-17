import { readFile } from "node:fs/promises";

import { LiveSyncBridge } from "./bridge.ts";
import { loadBridgeConfig, loadBridgeServerConfig } from "./config.ts";
import { startBridgeHttpServer } from "./server.ts";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

async function main(): Promise<void> {
  const [, , command, path] = process.argv;
  if (command === "serve") {
    const config = loadBridgeServerConfig();
    const server = await startBridgeHttpServer(config);
    process.stdout.write(
      `LiveSync Bridge 正在 ${config.host}:${config.port} 监听（仅本机）\n`,
    );
    await new Promise<void>((resolve) => {
      const close = (): void => {
        server.close(() => resolve());
        server.closeIdleConnections();
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });
    return;
  }

  if (!command || !path) {
    throw new Error(
      "用法：cli.ts serve；cli.ts read <vault-path> [--json]；或 cli.ts write <vault-path> --input <file> --expected-revision <rev> --idempotency-key <key>",
    );
  }
  const bridge = new LiveSyncBridge(loadBridgeConfig());

  if (command === "read") {
    const snapshot = await bridge.readNote(path);
    if (process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    } else {
      process.stdout.write(snapshot.content);
    }
    return;
  }

  if (command === "write") {
    const content = await readFile(requiredOption("--input"), "utf8");
    const result = await bridge.commitNote({
      path,
      content,
      expectedRevision: requiredOption("--expected-revision"),
      idempotencyKey: requiredOption("--idempotency-key"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`LiveSync Bridge: ${message}\n`);
  process.exitCode = 1;
});

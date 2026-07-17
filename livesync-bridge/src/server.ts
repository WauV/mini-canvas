import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { LiveSyncBridge, RevisionConflictError } from "./bridge.ts";
import type { BridgeServerConfig } from "./config.ts";
import { CouchDbHttpError } from "./couchdb.ts";

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": body.byteLength,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return provided.byteLength === wanted.byteLength && timingSafeEqual(provided, wanted);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new Error("请求必须使用 application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.byteLength;
    if (size > MAX_JSON_BYTES) throw new Error("请求正文超过 2 MiB 限制");
    chunks.push(chunk);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON 正文必须是对象");
  }
  return value as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new Error(`字段 ${key} 必须是字符串`);
  return value;
}

function routeNotFound(response: ServerResponse): void {
  sendJson(response, 404, { error: "not_found" });
}

export function createBridgeHttpServer(
  bridge: LiveSyncBridge,
  authToken: string,
): Server {
  if (!authToken) throw new Error("Bridge HTTP 服务不能使用空认证令牌");

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "mini-canvas-livesync-bridge" });
        return;
      }

      if (!tokenMatches(request.headers.authorization, authToken)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }

      if (request.method !== "POST") {
        routeNotFound(response);
        return;
      }

      const body = await readJson(request);
      if (url.pathname === "/v1/notes/read") {
        const note = await bridge.readNote(requireString(body, "path"));
        sendJson(response, 200, note);
        return;
      }

      if (url.pathname === "/v1/notes/commit") {
        const result = await bridge.commitNote({
          path: requireString(body, "path"),
          content: requireString(body, "content"),
          expectedRevision: requireString(body, "expectedRevision"),
          idempotencyKey: requireString(body, "idempotencyKey"),
        });
        sendJson(response, 200, result);
        return;
      }

      routeNotFound(response);
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        sendJson(response, 409, {
          error: "revision_conflict",
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
        });
        return;
      }
      if (error instanceof CouchDbHttpError && error.status === 404) {
        sendJson(response, 404, { error: "note_not_found" });
        return;
      }
      if (error instanceof SyntaxError || error instanceof TypeError) {
        sendJson(response, 400, { error: "invalid_request" });
        return;
      }
      if (error instanceof Error && /字段|请求|JSON|路径|必须/u.test(error.message)) {
        sendJson(response, 400, { error: "invalid_request", message: error.message });
        return;
      }
      console.error("LiveSync Bridge request failed", error);
      sendJson(response, 500, { error: "internal_error" });
    }
  });
}

export async function startBridgeHttpServer(
  config: BridgeServerConfig,
): Promise<Server> {
  const server = createBridgeHttpServer(new LiveSyncBridge(config), config.authToken);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

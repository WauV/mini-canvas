import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import {
  AttachmentTooLargeError,
  LiveSyncBridge,
  RevisionConflictError,
} from "./bridge.ts";
import type { BridgeServerConfig } from "./config.ts";
import { CouchDbHttpError } from "./couchdb.ts";
import {
  AuthenticationThrottle,
  constantTimeTokenEqual,
} from "./auth-security.ts";
import { API_SECURITY_HEADERS } from "./http-security.ts";
import type {
  ListVaultEntriesInput,
  VaultEntryKind,
} from "./types.ts";

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    ...API_SECURITY_HEADERS,
    "Content-Length": body.byteLength,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function sendBytes(
  response: ServerResponse,
  value: Uint8Array,
  headers: Record<string, string>,
): void {
  response.writeHead(200, {
    ...API_SECURITY_HEADERS,
    "Content-Length": String(value.byteLength),
    ...headers,
  });
  response.end(Buffer.from(value));
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return constantTimeTokenEqual(header.slice("Bearer ".length), expected);
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

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`字段 ${key} 必须是字符串`);
  return value;
}

function optionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new Error(`字段 ${key} 必须是整数`);
  return value as number;
}

function optionalStringArray(
  body: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`字段 ${key} 必须是字符串数组`);
  }
  return value as string[];
}

function routeNotFound(response: ServerResponse): void {
  sendJson(response, 404, { error: "not_found" });
}

export function createBridgeHttpServer(
  bridge: LiveSyncBridge,
  authToken: string,
  maxAttachmentBytes = 20 * 1024 * 1024,
): Server {
  if (!authToken) throw new Error("Bridge HTTP 服务不能使用空认证令牌");
  const authThrottle = new AuthenticationThrottle();

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const clientKey = request.socket.remoteAddress ?? "unknown";

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "mini-canvas-livesync-bridge" });
        return;
      }

      const retryAfter = authThrottle.retryAfterSeconds(clientKey);
      if (retryAfter > 0) {
        response.setHeader("Retry-After", String(retryAfter));
        sendJson(response, 429, { error: "too_many_authentication_failures" });
        return;
      }

      if (!tokenMatches(request.headers.authorization, authToken)) {
        authThrottle.recordFailure(clientKey);
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      authThrottle.recordSuccess(clientKey);

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

      if (url.pathname === "/v1/entries/list") {
        const kinds = optionalStringArray(body, "kinds") as
          | VaultEntryKind[]
          | undefined;
        const input: ListVaultEntriesInput = {
          cursor: optionalString(body, "cursor"),
          prefix: optionalString(body, "prefix"),
          kinds,
          extensions: optionalStringArray(body, "extensions"),
          limit: optionalInteger(body, "limit"),
        };
        sendJson(response, 200, await bridge.listEntries(input));
        return;
      }

      if (url.pathname === "/v1/changes/poll") {
        sendJson(
          response,
          200,
          await bridge.pollChanges({
            since: requireString(body, "since"),
            limit: optionalInteger(body, "limit"),
            timeoutMs: optionalInteger(body, "timeoutMs"),
          }),
        );
        return;
      }

      if (url.pathname === "/v1/attachments/read") {
        const attachment = await bridge.readAttachment(
          requireString(body, "path"),
          maxAttachmentBytes,
        );
        sendBytes(response, attachment.bytes, {
          "Content-Type": attachment.mimeType,
          "ETag": `"${attachment.revision}"`,
          "X-Mini-Canvas-Path": encodeURIComponent(attachment.path),
          "X-Mini-Canvas-Revision": attachment.revision,
          "X-Mini-Canvas-Ctime": String(attachment.ctime),
          "X-Mini-Canvas-Mtime": String(attachment.mtime),
        });
        return;
      }

      routeNotFound(response);
    } catch (error) {
      if (error instanceof AttachmentTooLargeError) {
        sendJson(response, 413, {
          error: "attachment_too_large",
          size: error.size,
          maximum: error.maximum,
        });
        return;
      }
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
      if (
        error instanceof Error &&
        /字段|请求|JSON|路径|必须|列表|变更|附件|Base64|大小校验/u.test(error.message)
      ) {
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
  const server = createBridgeHttpServer(
    new LiveSyncBridge(config),
    config.authToken,
    config.maxAttachmentBytes,
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

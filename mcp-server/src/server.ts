import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";

import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { principalFromAuth } from "./auth.ts";
import { AuthenticationThrottle } from "../../livesync-bridge/src/auth-security.ts";
import { API_SECURITY_HEADERS } from "../../livesync-bridge/src/http-security.ts";
import type { McpConfig } from "./config.ts";
import { createMiniCanvasMcpServer } from "./mcp.ts";
import type { McpRuntime } from "./runtime.ts";

const MAX_MCP_JSON_BYTES = 2 * 1024 * 1024;

export async function startMcpHttpServer(
  config: McpConfig,
  runtime: McpRuntime,
): Promise<Server> {
  // The SDK helper installs Express' default ~100 KB JSON parser. Markdown
  // tool calls legitimately carry larger complete-document payloads, so build
  // the same protected app explicitly with the Bridge-aligned 2 MiB limit.
  const app = express();
  app.use(express.json({ limit: MAX_MCP_JSON_BYTES, strict: true }));
  app.use(hostHeaderValidation(config.allowedHosts));
  const authThrottle = new AuthenticationThrottle();

  app.use((_request: Request, response: Response, next) => {
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    next();
  });

  app.get("/health", async (_request: Request, response: Response) => {
    const bridge = await runtime.gateway.health();
    const search = runtime.search.health();
    response.status(bridge ? 200 : 503).json({
      ok: bridge && search.status !== "uninitialized",
      service: "mini-canvas-mcp",
      bridge: bridge ? "ready" : "unavailable",
      search: search.status,
      lastSequence: search.lastSequence,
      lastEventAt: search.lastEventAt,
    });
  });

  // This deployment intentionally exposes no OAuth challenge to ChatGPT. The
  // Tunnel injects the private Bearer token only on the local MCP hop. Return a
  // JSON 404 instead of an empty response: tunnel-client v0.0.10 treats an
  // empty 404 body as a failed discovery response, while a normal 404 means
  // that this is intentionally a non-OAuth MCP server.
  const oauthMetadataNotAvailable = (_request: Request, response: Response) => {
    response.status(404).json({ error: "oauth_metadata_not_available" });
  };
  app.get(
    "/.well-known/oauth-protected-resource/mcp",
    oauthMetadataNotAvailable,
  );
  app.get(
    "/.well-known/oauth-protected-resource",
    oauthMetadataNotAvailable,
  );

  app.use("/mcp", (request: Request, response: Response, next) => {
    const clientKey = request.socket.remoteAddress ?? "unknown";
    const retryAfter = authThrottle.retryAfterSeconds(clientKey);
    if (retryAfter > 0) {
      response.setHeader("Retry-After", String(retryAfter));
      response.status(429).json({ error: "too_many_authentication_failures" });
      return;
    }
    response.on("finish", () => {
      if (response.statusCode === 401) authThrottle.recordFailure(clientKey);
      else if (response.statusCode < 400) authThrottle.recordSuccess(clientKey);
    });
    next();
  });

  app.use(
    "/mcp",
    requireBearerAuth({
      verifier: runtime.verifier,
      requiredScopes: [],
    }),
  );

  app.post("/mcp", async (request: Request, response: Response) => {
    const server = createMiniCanvasMcpServer(
      runtime.service,
      principalFromAuth(request.auth),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      response.on("close", () => {
        void transport.close().finally(() => server.close());
      });
    } catch (error) {
      console.error("Mini Canvas MCP request failed", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_request: Request, response: Response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (
        error instanceof Error &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        response.status(413).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "MCP request body exceeds 2 MiB" },
          id: null,
        });
        return;
      }
      next(error);
    },
  );

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve(server);
    });
    server.once("error", reject);
  });
}

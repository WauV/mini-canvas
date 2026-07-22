import type { Server } from "node:http";
import type { Request, Response } from "express";

import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { principalFromAuth } from "./auth.ts";
import { AuthenticationThrottle } from "../../livesync-bridge/src/auth-security.ts";
import { API_SECURITY_HEADERS } from "../../livesync-bridge/src/http-security.ts";
import type { McpConfig } from "./config.ts";
import { createMiniCanvasMcpServer } from "./mcp.ts";
import type { McpRuntime } from "./runtime.ts";

export async function startMcpHttpServer(
  config: McpConfig,
  runtime: McpRuntime,
): Promise<Server> {
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  });
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
  // clean 404 so discovery clients do not try to parse Express' HTML fallback.
  const oauthMetadataNotAvailable = (_request: Request, response: Response) => {
    response.status(404).end();
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

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve(server);
    });
    server.once("error", reject);
  });
}

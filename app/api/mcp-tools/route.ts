import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const dynamic = "force-dynamic";

const EDITOR_TOOLS = new Set([
  "list_entries",
  "create_draft",
  "get_draft",
  "update_draft",
  "preview_commit",
  "commit_draft",
]);

function localProxyConfig(request: Request): { url: URL; token: string } | null {
  const requestUrl = new URL(request.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(requestUrl.hostname)) {
    return null;
  }

  const rawUrl = process.env.MINI_CANVAS_LOCAL_MCP_URL;
  const token = process.env.MINI_CANVAS_LOCAL_MCP_TOKEN;
  if (!rawUrl || !token) return null;

  const url = new URL(rawUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return null;
  }
  return { url, token };
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: Request): Promise<Response> {
  const config = localProxyConfig(request);
  if (!config) {
    return Response.json({ available: false }, { status: 404 });
  }
  try {
    const healthUrl = new URL("/health", config.url);
    const response = await fetch(healthUrl, { cache: "no-store" });
    return Response.json({ available: response.ok }, { status: response.ok ? 200 : 503 });
  } catch {
    return Response.json({ available: false }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const config = localProxyConfig(request);
  if (!config) {
    return Response.json({ error: "local_mcp_unavailable" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = payload as { name?: unknown; arguments?: unknown };
  if (
    typeof body.name !== "string" ||
    !EDITOR_TOOLS.has(body.name) ||
    !body.arguments ||
    typeof body.arguments !== "object" ||
    Array.isArray(body.arguments)
  ) {
    return Response.json({ error: "invalid_tool_call" }, { status: 400 });
  }

  const client = new Client({ name: "mini-canvas-local-editor", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(config.url, {
    requestInit: {
      headers: { Authorization: `Bearer ${config.token}` },
    },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: body.name,
      arguments: body.arguments as Record<string, unknown>,
    });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "mcp_tool_unavailable" }, { status: 502 });
  } finally {
    await client.close().catch(() => undefined);
  }
}

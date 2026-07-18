export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpToolResult = {
  structuredContent?: unknown;
  content?: Array<McpTextContent | Record<string, unknown>>;
  isError?: boolean;
};

export interface McpToolClient {
  callTool(name: string, arguments_: Record<string, unknown>): Promise<McpToolResult>;
  close?(): void;
}

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function isToolResult(value: unknown): value is McpToolResult {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export class LocalMcpToolClient implements McpToolClient {
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const response = await this.fetcher("/api/mcp-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: arguments_ }),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok || !isToolResult(value)) {
      throw new Error("本地 MCP 草稿服务暂时不可用");
    }
    return value;
  }
}

export class McpAppsBridgeToolClient implements McpToolClient {
  private requestId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(reason: unknown): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly onMessage = (event: MessageEvent): void => {
    if (event.source !== window.parent) return;
    const value: unknown = event.data;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const response = value as Partial<JsonRpcResponse>;
    if (response.jsonrpc !== "2.0" || typeof response.id !== "number") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.error) {
      pending.reject(new Error(response.error.message ?? "MCP Apps 调用失败"));
    } else {
      pending.resolve(response.result);
    }
  };
  private readonly bridgeReady: Promise<void>;

  constructor() {
    window.addEventListener("message", this.onMessage, { passive: true });
    this.bridgeReady = this.initialize();
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("MCP Apps 宿主响应超时"));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  private async initialize(): Promise<void> {
    await this.request("ui/initialize", {
      appInfo: { name: "mini-canvas", version: "0.1.0" },
      appCapabilities: {},
      protocolVersion: "2026-01-26",
    });
    this.notify("ui/notifications/initialized", {});
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<McpToolResult> {
    await this.bridgeReady;
    const value = await this.request("tools/call", {
      name,
      arguments: arguments_,
    });
    if (!isToolResult(value)) throw new Error("MCP Apps 返回了无效的工具结果");
    return value;
  }

  close(): void {
    window.removeEventListener("message", this.onMessage);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MCP Apps 客户端已经关闭"));
    }
    this.pending.clear();
  }
}

export function createMcpToolClient(): McpToolClient {
  return window.parent !== window
    ? new McpAppsBridgeToolClient()
    : new LocalMcpToolClient();
}

import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type McpToolResult = {
  structuredContent?: unknown;
  content?: Array<McpTextContent | McpImageContent | Record<string, unknown>>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

export type McpDisplayMode = "inline" | "fullscreen" | "pip";
export type McpToolResultListener = (result: McpToolResult) => void;

export interface McpToolClient {
  callTool(name: string, arguments_: Record<string, unknown>): Promise<McpToolResult>;
  subscribeToolResults?(listener: McpToolResultListener): () => void;
  requestDisplayMode?(mode: McpDisplayMode): Promise<McpDisplayMode>;
  close?(): void;
}

export class LazyMcpToolClient implements McpToolClient {
  private readonly factory: () => McpToolClient;
  private client: McpToolClient | null = null;

  constructor(factory: () => McpToolClient = createMcpToolClient) {
    this.factory = factory;
  }

  private get(): McpToolClient {
    this.client ??= this.factory();
    return this.client;
  }

  callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<McpToolResult> {
    return this.get().callTool(name, arguments_);
  }

  subscribeToolResults(listener: McpToolResultListener): () => void {
    return this.get().subscribeToolResults?.(listener) ?? (() => undefined);
  }

  async requestDisplayMode(mode: McpDisplayMode): Promise<McpDisplayMode> {
    const client = this.get();
    if (!client.requestDisplayMode) {
      throw new Error("当前宿主不支持切换 Widget 展示模式");
    }
    return client.requestDisplayMode(mode);
  }

  close(): void {
    this.client?.close?.();
    this.client = null;
  }
}

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
  private readonly app: App;
  private readonly bridgeReady: Promise<void>;
  private readonly toolResultListeners = new Set<McpToolResultListener>();
  private lastHostToolResult: McpToolResult | null = null;

  constructor() {
    this.app = new App(
      { name: "mini-canvas", version: "0.1.0" },
      {},
      { autoResize: true, strict: true },
    );
    this.app.ontoolresult = (result) => {
      if (!isToolResult(result)) return;
      this.lastHostToolResult = result;
      for (const listener of this.toolResultListeners) listener(result);
    };
    this.bridgeReady = this.app.connect(
      new PostMessageTransport(window.parent, window.parent),
    );
    void this.bridgeReady.catch(() => undefined);
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<McpToolResult> {
    await this.bridgeReady;
    const value = await this.app.callServerTool({
      name,
      arguments: arguments_,
    });
    if (!isToolResult(value)) throw new Error("MCP Apps 返回了无效的工具结果");
    return value;
  }

  subscribeToolResults(listener: McpToolResultListener): () => void {
    this.toolResultListeners.add(listener);
    if (this.lastHostToolResult) listener(this.lastHostToolResult);
    return () => this.toolResultListeners.delete(listener);
  }

  async requestDisplayMode(mode: McpDisplayMode): Promise<McpDisplayMode> {
    await this.bridgeReady;
    return (await this.app.requestDisplayMode({ mode })).mode;
  }

  close(): void {
    this.toolResultListeners.clear();
    void this.app.close();
  }
}

export function createMcpToolClient(): McpToolClient {
  return window.parent !== window
    ? new McpAppsBridgeToolClient()
    : new LocalMcpToolClient();
}

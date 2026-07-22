import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { MiniCanvas } from "../../app/MiniCanvas";
import {
  DOCUMENT_STORAGE_PREFIX,
  RECOVERY_STORAGE_KEY,
} from "../../app/lib/documents/local-storage-repository";
import type { DraftSnapshot } from "../../app/lib/mcp/mini-canvas-client";
import type {
  McpDisplayMode,
  McpToolClient,
  McpToolResult,
  McpToolResultListener,
} from "../../app/lib/mcp/tool-client";

const toolHarness = vi.hoisted(() => ({
  current: null as McpToolClient | null,
}));

vi.mock("../../app/components/Editor", () => ({
  Editor: ({
    content,
    mode,
    onChange,
    readOnly,
  }: {
    content: string;
    mode: string;
    onChange(content: string): void;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label="Markdown 内容"
      data-mode={mode}
      readOnly={readOnly}
      value={content}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("../../app/lib/mcp/tool-client", () => {
  const current = () => {
    if (!toolHarness.current) throw new Error("missing test MCP client");
    return toolHarness.current;
  };
  return {
    LazyMcpToolClient: class {
      callTool(name: string, arguments_: Record<string, unknown>) {
        return current().callTool(name, arguments_);
      }

      subscribeToolResults(listener: McpToolResultListener) {
        return current().subscribeToolResults?.(listener) ?? (() => undefined);
      }

      requestDisplayMode(mode: McpDisplayMode) {
        const client = current();
        if (!client.requestDisplayMode) throw new Error("display mode unsupported");
        return client.requestDisplayMode(mode);
      }

      close() {
        current().close?.();
      }
    },
  };
});

function activeDraft(content = "# MCP 原文", version = 1): DraftSnapshot {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "tester",
    path: "Notes/Test.md",
    content,
    baseRevision: "1-base",
    isNew: false,
    version,
    status: "active",
    createdAt: 1,
    updatedAt: version,
    expiresAt: 9_999_999_999_999,
  };
}

class FakeMcpTools implements McpToolClient {
  currentDraft = activeDraft();
  conflictNextUpdate = false;
  failNextUpdate = false;
  previewGate: Promise<void> | null = null;
  requestedDisplayModes: McpDisplayMode[] = [];
  readonly calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  private readonly listeners = new Set<McpToolResultListener>();

  async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<McpToolResult> {
    this.calls.push({ name, arguments: arguments_ });
    if (name === "list_entries") {
      return {
        structuredContent: {
          entries: [
            {
              path: "Notes/Test.md",
              kind: "note",
              mimeType: "text/markdown; charset=utf-8",
              revision: "1-base",
              ctime: 1,
              mtime: 2,
              size: 24,
            },
          ],
          baselineSequence: "1-test",
        },
      };
    }
    if (name === "create_draft" || name === "get_draft") {
      return { structuredContent: this.currentDraft };
    }
    if (name === "update_draft") {
      const expectedVersion = Number(arguments_.expectedVersion);
      if (this.failNextUpdate) {
        this.failNextUpdate = false;
        return {
          isError: true,
          content: [{ type: "text", text: "MCP 草稿保存暂时失败" }],
        };
      }
      if (this.conflictNextUpdate) {
        this.conflictNextUpdate = false;
        this.currentDraft = activeDraft("# Obsidian 新版本", expectedVersion + 1);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "draft_conflict",
                expectedVersion,
                actualVersion: this.currentDraft.version,
              }),
            },
          ],
        };
      }
      this.currentDraft = activeDraft(
        String(arguments_.content),
        expectedVersion + 1,
      );
      return { structuredContent: this.currentDraft };
    }
    if (name === "preview_commit") {
      await this.previewGate;
      return {
        structuredContent: {
          draftId: this.currentDraft.id,
          path: this.currentDraft.path,
          version: this.currentDraft.version,
          confirmationToken: "p".repeat(43),
          baseRevision: this.currentDraft.baseRevision,
          isNew: this.currentDraft.isNew,
          changed: true,
          characterDelta: 6,
          lineDelta: 1,
          contentSha256: "a".repeat(64),
        },
      };
    }
    if (name === "commit_draft") {
      const committed: DraftSnapshot = {
        ...this.currentDraft,
        status: "committed",
        committedRevision: "2-committed",
      };
      this.currentDraft = committed;
      return {
        structuredContent: {
          draft: committed,
          note: {
            path: committed.path,
            content: committed.content,
            revision: "2-committed",
            ctime: 1,
            mtime: 2,
            size: committed.content.length,
            children: [],
            idempotentReplay: false,
          },
        },
      };
    }
    throw new Error(`unexpected tool: ${name}`);
  }

  subscribeToolResults(listener: McpToolResultListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(result: McpToolResult): void {
    for (const listener of this.listeners) listener(result);
  }

  async requestDisplayMode(mode: McpDisplayMode): Promise<McpDisplayMode> {
    this.requestedDisplayModes.push(mode);
    return mode;
  }
}

function seedLocalDocument(): string {
  const key = DOCUMENT_STORAGE_PREFIX + "default";
  window.localStorage.setItem(
    key,
    JSON.stringify({
      schemaVersion: 1,
      document: {
        id: "default",
        title: "现有本地笔记",
        content: "# 已保存正文",
        version: "local-existing",
        updatedAt: 123,
      },
      lastIdempotencyKey: "seed",
    }),
  );
  return key;
}

function writeStoredDocument(
  key: string,
  document: {
    title: string;
    content: string;
    version: string;
    updatedAt?: number;
  },
): void {
  window.localStorage.setItem(
    key,
    JSON.stringify({
      schemaVersion: 1,
      document: {
        id: "default",
        updatedAt: document.updatedAt ?? Date.now(),
        ...document,
      },
      lastIdempotencyKey: "external-write",
    }),
  );
}

function readStoredDocument(key: string): {
  title: string;
  content: string;
  version: string;
} {
  const value = window.localStorage.getItem(key);
  if (!value) throw new Error("missing stored document");
  return JSON.parse(value).document as {
    title: string;
    content: string;
    version: string;
  };
}

async function renderLoadedPage(): Promise<FakeMcpTools> {
  const tools = new FakeMcpTools();
  toolHarness.current = tools;
  render(<MiniCanvas />);
  await screen.findByDisplayValue("现有本地笔记");
  return tools;
}

describe("MiniCanvas 关键交互", () => {
  beforeEach(() => {
    seedLocalDocument();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  test("加载现有文档后不产生无意义的新版本", async () => {
    const key = DOCUMENT_STORAGE_PREFIX + "default";
    const before = window.localStorage.getItem(key);

    await renderLoadedPage();
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 380)));

    expect(window.localStorage.getItem(key)).toBe(before);
    expect(screen.getByText("已保存到本机")).toBeInTheDocument();
  });

  test("取消新建不会覆盖正文或提前写入恢复槽", async () => {
    await renderLoadedPage();
    vi.mocked(window.confirm).mockReturnValue(false);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByDisplayValue("现有本地笔记")).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown 内容")).toHaveValue("# 已保存正文");
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
  });

  test("本地标题和正文修改会合并为一次自动保存", async () => {
    const key = DOCUMENT_STORAGE_PREFIX + "default";
    await renderLoadedPage();

    fireEvent.change(screen.getByLabelText("文档标题"), {
      target: { value: "本地修改标题" },
    });
    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# 本地修改正文" },
    });

    await waitFor(
      () =>
        expect(readStoredDocument(key).content).toBe("# 本地修改正文"),
      { timeout: 1_500 },
    );
    expect(readStoredDocument(key)).toMatchObject({
      title: "本地修改标题",
      content: "# 本地修改正文",
    });
    expect(readStoredDocument(key).version).not.toBe("local-existing");
  });

  test("加载示例会先备份，恢复按钮能找回原文", async () => {
    await renderLoadedPage();

    fireEvent.click(screen.getByRole("button", { name: "示例" }));
    await screen.findByDisplayValue("Mini Canvas 使用指南");
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toContain(
      "# 已保存正文",
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    await screen.findByDisplayValue("现有本地笔记");
    expect(screen.getByLabelText("Markdown 内容")).toHaveValue("# 已保存正文");
  });

  test("保存冲突时可以载入外部较新版本并备份本地编辑", async () => {
    const key = DOCUMENT_STORAGE_PREFIX + "default";
    await renderLoadedPage();
    writeStoredDocument(key, {
      title: "外部版本",
      content: "# Obsidian 外部修改",
      version: "external-v2",
    });

    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# 尚未保存的本地修改" },
    });
    await screen.findByText("保存冲突", {}, { timeout: 1_500 });
    fireEvent.click(screen.getByRole("button", { name: "载入已保存" }));

    await screen.findByDisplayValue("外部版本");
    expect(screen.getByLabelText("Markdown 内容")).toHaveValue(
      "# Obsidian 外部修改",
    );
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toContain(
      "# 尚未保存的本地修改",
    );
  });

  test("保存冲突时可以明确保留当前编辑并覆盖外部版本", async () => {
    const key = DOCUMENT_STORAGE_PREFIX + "default";
    await renderLoadedPage();
    writeStoredDocument(key, {
      title: "外部版本",
      content: "# 外部修改",
      version: "external-v2",
    });

    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# 我选择保留的本地修改" },
    });
    await screen.findByText("保存冲突", {}, { timeout: 1_500 });
    fireEvent.click(screen.getByRole("button", { name: "保留当前" }));

    await waitFor(
      () => expect(screen.getByText("已保存到本机")).toBeInTheDocument(),
      { timeout: 1_500 },
    );
    expect(readStoredDocument(key).content).toBe("# 我选择保留的本地修改");
  });

  test("笔记选择器支持按路径过滤并可关闭", async () => {
    await renderLoadedPage();
    fireEvent.click(screen.getByRole("button", { name: "打开笔记" }));
    await screen.findByRole("button", { name: /Test/ });

    fireEvent.change(screen.getByPlaceholderText("搜索文件夹或笔记名称…"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有找到匹配的 Markdown 笔记。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭笔记列表" }));

    expect(
      screen.queryByRole("dialog", { name: "打开 Obsidian 笔记" }),
    ).not.toBeInTheDocument();
  });

  test("从选择器打开草稿、自动保存、预览并正式提交", async () => {
    const tools = await renderLoadedPage();

    fireEvent.click(screen.getByRole("button", { name: "打开笔记" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test/ }));
    await screen.findByDisplayValue("Test");

    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# MCP 修改后\n\n正文" },
    });
    await waitFor(
      () => expect(tools.calls.some((call) => call.name === "update_draft")).toBe(true),
      { timeout: 1_500 },
    );

    fireEvent.click(screen.getByRole("button", { name: "预览提交" }));
    expect(await screen.findByRole("dialog", { name: "写回 Obsidian" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "正式提交" }));

    expect(await screen.findByText(/已提交到 Obsidian · revision 2-committed/)).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown 内容")).toHaveAttribute("readonly");
    expect(tools.calls.map((call) => call.name)).toEqual(
      expect.arrayContaining([
        "list_entries",
        "create_draft",
        "update_draft",
        "preview_commit",
        "commit_draft",
      ]),
    );
  });

  test("MCP 保存失败时保留当前编辑并阻止切换笔记", async () => {
    const tools = await renderLoadedPage();
    fireEvent.click(screen.getByRole("button", { name: "打开笔记" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test/ }));
    await screen.findByDisplayValue("Test");

    tools.failNextUpdate = true;
    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# 尚未安全保存" },
    });
    fireEvent.click(screen.getByRole("button", { name: "打开笔记" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test/ }));

    expect(
      await screen.findByText(/当前草稿保存失败，未切换笔记/u),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown 内容")).toHaveValue("# 尚未安全保存");
    expect(tools.calls.filter((call) => call.name === "create_draft")).toHaveLength(1);
  });

  test("生成提交预览期间锁定编辑器并提交对应确认令牌", async () => {
    const tools = await renderLoadedPage();
    fireEvent.click(screen.getByRole("button", { name: "打开笔记" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test/ }));
    await screen.findByDisplayValue("Test");

    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# 准备预览的版本" },
    });
    await waitFor(
      () => expect(tools.currentDraft.content).toBe("# 准备预览的版本"),
      { timeout: 1_500 },
    );

    let releasePreview = () => undefined;
    tools.previewGate = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    fireEvent.click(screen.getByRole("button", { name: "预览提交" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Markdown 内容")).toHaveAttribute("readonly"),
    );
    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# 不应进入预览的版本" },
    });
    expect(screen.getByLabelText("Markdown 内容")).toHaveValue("# 准备预览的版本");

    await act(async () => releasePreview());
    expect(
      await screen.findByRole("dialog", { name: "写回 Obsidian" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "正式提交" }));
    await screen.findByText(/已提交到 Obsidian · revision/u);
    const commit = tools.calls.find((call) => call.name === "commit_draft");
    expect(commit?.arguments.confirmationToken).toBe("p".repeat(43));
  });

  test("草稿乐观锁冲突会停止自动覆盖并给出恢复动作", async () => {
    const tools = await renderLoadedPage();
    fireEvent.click(screen.getByRole("button", { name: "打开笔记" }));
    fireEvent.click(await screen.findByRole("button", { name: /Test/ }));
    await screen.findByDisplayValue("Test");
    tools.conflictNextUpdate = true;

    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# 本地冲突版本" },
    });

    expect(await screen.findByText("保存冲突", {}, { timeout: 1_500 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保留当前" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "载入已保存" })).toBeInTheDocument();
    const updatesBefore = tools.calls.filter((call) => call.name === "update_draft").length;
    fireEvent.change(screen.getByLabelText("Markdown 内容"), {
      target: { value: "# 冲突后继续输入" },
    });
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 380)));
    expect(tools.calls.filter((call) => call.name === "update_draft")).toHaveLength(
      updatesBefore,
    );
  });

  test("Widget 初始工具结果能载入草稿并请求全屏", async () => {
    const tools = new FakeMcpTools();
    toolHarness.current = tools;
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    render(<MiniCanvas hostMode="widget" />);

    act(() => {
      tools.emit({
        structuredContent: { mode: "draft", draftId: tools.currentDraft.id },
      });
    });

    await screen.findByDisplayValue("Test");
    expect(screen.getByLabelText("Markdown 内容")).toHaveValue("# MCP 原文");
    fireEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    expect(await screen.findByText("已切换为全屏编辑")).toBeInTheDocument();
    expect(tools.requestedDisplayModes).toEqual(["fullscreen"]);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  test("Widget 无路径启动结果会打开隔离 Vault 选择器", async () => {
    const tools = new FakeMcpTools();
    toolHarness.current = tools;
    render(<MiniCanvas hostMode="widget" />);

    act(() => tools.emit({ structuredContent: { mode: "picker" } }));

    expect(await screen.findByRole("dialog", { name: "打开 Obsidian 笔记" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Test/ })).toBeInTheDocument();
  });
});

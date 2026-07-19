import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { CanvasViewBar } from "../../app/components/canvas/CanvasViewBar";
import { CommitPreviewDialog } from "../../app/components/canvas/CommitPreviewDialog";
import { McpNotice } from "../../app/components/canvas/McpNotice";
import type { DraftSnapshot } from "../../app/lib/mcp/mini-canvas-client";

function draft(status: DraftSnapshot["status"]): DraftSnapshot {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "tester",
    path: "Notes/Test.md",
    content: "正文",
    baseRevision: "1-base",
    version: 2,
    status,
    createdAt: 1,
    updatedAt: 2,
    expiresAt: 9_999_999_999_999,
  };
}

describe("Canvas 展示组件", () => {
  test("视图栏切换模式并展示文档统计", () => {
    const onModeChange = vi.fn();
    render(
      <CanvasViewBar
        mode="live"
        isWidget={false}
        draft={null}
        busy={false}
        hasSaveConflict={false}
        statistics={{ lines: 3, words: 8, characters: 21 }}
        onModeChange={onModeChange}
        onPreviewCommit={() => undefined}
        onContinueEditing={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Markdown 源码" }));
    expect(onModeChange).toHaveBeenCalledWith("source");
    expect(screen.getByText("3 行")).toBeInTheDocument();
    expect(screen.getByText("8 字词")).toBeInTheDocument();
    expect(screen.getByText("21 字符")).toBeInTheDocument();
  });

  test("活动草稿冲突时禁止提交，已提交草稿可以继续编辑", () => {
    const onContinueEditing = vi.fn();
    const view = render(
      <CanvasViewBar
        mode="live"
        isWidget
        draft={draft("active")}
        busy={false}
        hasSaveConflict
        statistics={{ lines: 1, words: 2, characters: 2 }}
        onModeChange={() => undefined}
        onPreviewCommit={() => undefined}
        onContinueEditing={onContinueEditing}
      />,
    );
    expect(screen.getByRole("button", { name: "预览提交" })).toBeDisabled();

    view.rerender(
      <CanvasViewBar
        mode="live"
        isWidget
        draft={draft("committed")}
        busy={false}
        hasSaveConflict={false}
        statistics={{ lines: 1, words: 2, characters: 2 }}
        onModeChange={() => undefined}
        onPreviewCommit={() => undefined}
        onContinueEditing={onContinueEditing}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(onContinueEditing).toHaveBeenCalledWith("Notes/Test.md");
  });

  test("无变化的提交预览不会允许正式提交", () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(
      <CommitPreviewDialog
        busy={false}
        preview={{
          draftId: "11111111-1111-4111-8111-111111111111",
          path: "Notes/Test.md",
          version: 2,
          baseRevision: "1-base",
          changed: false,
          characterDelta: -2,
          lineDelta: 0,
          contentSha256: "a".repeat(64),
        }}
        onClose={onClose}
        onCommit={onCommit}
      />,
    );

    expect(screen.getByText("-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "没有变化" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "返回编辑" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("MCP 通知可以关闭", () => {
    const onClose = vi.fn();
    render(
      <McpNotice
        notice={{ kind: "error", text: "Bridge 暂时不可用" }}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Bridge 暂时不可用");
    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

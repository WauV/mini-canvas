import type { EditorMode } from "../Editor";
import type { DocumentStatistics } from "../../lib/document-statistics";
import type { DraftSnapshot } from "../../lib/mcp/mini-canvas-client";

type CanvasViewBarProps = {
  mode: EditorMode;
  isWidget: boolean;
  draft: DraftSnapshot | null;
  busy: boolean;
  hasSaveConflict: boolean;
  statistics: DocumentStatistics;
  onModeChange(mode: EditorMode): void;
  onPreviewCommit(): void;
  onContinueEditing(path: string): void;
};

export function CanvasViewBar({
  mode,
  isWidget,
  draft,
  busy,
  hasSaveConflict,
  statistics,
  onModeChange,
  onPreviewCommit,
  onContinueEditing,
}: CanvasViewBarProps) {
  return (
    <nav className="view-bar" aria-label="视图控制">
      <div className="view-switch" role="group" aria-label="选择工作区视图">
        <button
          type="button"
          className={mode === "live" ? "is-active" : ""}
          aria-pressed={mode === "live"}
          onClick={() => onModeChange("live")}
        >
          Live Preview
        </button>
        <button
          type="button"
          className={mode === "source" ? "is-active" : ""}
          aria-pressed={mode === "source"}
          onClick={() => onModeChange("source")}
        >
          Markdown 源码
        </button>
      </div>
      <div className="view-bar-meta">
        <p>
          <span aria-hidden="true">◇</span>
          {draft
            ? `${draft.path} · 草稿 v${draft.version}`
            : isWidget
              ? "请选择隔离 Vault 中的 Obsidian 笔记"
              : "Obsidian Markdown · 本地预览"}
        </p>
        {draft ? (
          <div className="mcp-draft-actions" aria-label="MCP 草稿操作">
            {draft.status === "active" ? (
              <button
                type="button"
                className="draft-action"
                onClick={onPreviewCommit}
                disabled={busy || hasSaveConflict}
              >
                {busy ? "正在处理…" : "预览提交"}
              </button>
            ) : (
              <button
                type="button"
                className="draft-action"
                onClick={() => onContinueEditing(draft.path)}
                disabled={busy}
              >
                {busy ? "正在创建草稿…" : "继续编辑"}
              </button>
            )}
          </div>
        ) : null}
        <div className="document-stats" aria-label="文档统计">
          <span>{statistics.lines} 行</span>
          <span>{statistics.words} 字词</span>
          <span>{statistics.characters} 字符</span>
        </div>
      </div>
    </nav>
  );
}

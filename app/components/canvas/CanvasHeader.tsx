import type { DocumentSnapshot } from "../../lib/documents/types";
import type { DraftSnapshot } from "../../lib/mcp/mini-canvas-client";
import type {
  SaveConflict,
  SaveState,
} from "../../lib/documents/document-persistence-state";

type CanvasHeaderProps = {
  document: DocumentSnapshot;
  draft: DraftSnapshot | null;
  isWidget: boolean;
  saveState: SaveState;
  saveLabel: string;
  saveConflict: SaveConflict | null;
  resolvingConflict: boolean;
  hasRecovery: boolean;
  busy: boolean;
  onTitleChange(title: string): void;
  onKeepCurrent(): void;
  onLoadSaved(): void;
  onRestore(): void;
  onNew(): void;
  onExample(): void;
  onFullscreen(): void;
  onOpenNote(): void;
};

export function CanvasHeader({
  document,
  draft,
  isWidget,
  saveState,
  saveLabel,
  saveConflict,
  resolvingConflict,
  hasRecovery,
  busy,
  onTitleChange,
  onKeepCurrent,
  onLoadSaved,
  onRestore,
  onNew,
  onExample,
  onFullscreen,
  onOpenNote,
}: CanvasHeaderProps) {
  return (
    <header className="canvas-header">
      <div className="brand-group">
        <div className="brand-mark" aria-hidden="true">
          M
        </div>
        <div className="brand-copy">
          <strong>Mini Canvas</strong>
          <span>Markdown · LaTeX</span>
        </div>
      </div>

      <label className="document-title-field">
        <span className="sr-only">文档标题</span>
        <input
          value={document.title}
          onChange={(event) => onTitleChange(event.target.value)}
          readOnly={isWidget || Boolean(draft)}
          placeholder="未命名笔记"
          aria-label="文档标题"
          title={draft?.path}
        />
      </label>

      <div className="header-actions">
        <span
          className={`save-state save-state-${saveState}`}
          aria-live="polite"
          title={
            saveConflict
              ? `期望版本：${saveConflict.expectedVersion}；当前版本：${saveConflict.actualVersion}`
              : undefined
          }
        >
          <span className="save-dot" aria-hidden="true" />
          {saveLabel}
        </span>
        {saveConflict ? (
          <div className="conflict-actions" aria-label="解决保存冲突">
            <button
              className="conflict-action"
              type="button"
              onClick={onKeepCurrent}
              disabled={resolvingConflict}
            >
              保留当前
            </button>
            <button
              className="conflict-action"
              type="button"
              onClick={onLoadSaved}
              disabled={resolvingConflict}
            >
              载入已保存
            </button>
          </div>
        ) : null}
        {!isWidget && hasRecovery ? (
          <button
            className="secondary-button header-action-recovery"
            type="button"
            onClick={onRestore}
          >
            恢复
          </button>
        ) : null}
        {!isWidget ? (
          <>
            <button
              className="secondary-button header-action-new"
              type="button"
              onClick={onNew}
            >
              新建
            </button>
            <button
              className="secondary-button header-action-example"
              type="button"
              onClick={onExample}
            >
              示例
            </button>
          </>
        ) : (
          <button
            className="secondary-button widget-fullscreen-action"
            type="button"
            onClick={onFullscreen}
            disabled={busy}
          >
            全屏编辑
          </button>
        )}
        <button
          className="primary-button"
          type="button"
          onClick={onOpenNote}
          disabled={busy}
        >
          打开笔记
        </button>
      </div>
    </header>
  );
}

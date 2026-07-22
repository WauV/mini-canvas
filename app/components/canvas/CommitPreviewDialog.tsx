import type { CommitPreview } from "../../lib/mcp/mini-canvas-client";

type CommitPreviewDialogProps = {
  preview: CommitPreview;
  busy: boolean;
  onClose(): void;
  onCommit(): void;
};

export function CommitPreviewDialog({
  preview,
  busy,
  onClose,
  onCommit,
}: CommitPreviewDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="canvas-dialog commit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-preview-title"
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-eyebrow">提交前确认</span>
            <h2 id="commit-preview-title">写回 Obsidian</h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label="关闭提交预览"
          >
            ×
          </button>
        </header>
        <dl className="commit-summary">
          <div>
            <dt>笔记</dt>
            <dd>{preview.path}</dd>
          </div>
          <div>
            <dt>字符变化</dt>
            <dd>{preview.characterDelta >= 0 ? "+" : ""}{preview.characterDelta}</dd>
          </div>
          <div>
            <dt>行数变化</dt>
            <dd>{preview.lineDelta >= 0 ? "+" : ""}{preview.lineDelta}</dd>
          </div>
          <div>
            <dt>{preview.isNew ? "提交类型" : "基线 revision"}</dt>
            <dd>{preview.isNew ? "创建新笔记" : preview.baseRevision}</dd>
          </div>
        </dl>
        <p className="commit-hash">
          内容摘要 · {preview.contentSha256.slice(0, 16)}…
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            返回编辑
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onCommit}
            disabled={!preview.changed || busy}
          >
            {preview.changed
              ? preview.isNew
                ? "创建笔记"
                : "正式提交"
              : "没有变化"}
          </button>
        </div>
      </section>
    </div>
  );
}

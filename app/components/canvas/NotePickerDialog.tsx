import { titleFromVaultPath } from "../../lib/documents/mcp-draft-repository";
import type { VaultNoteEntry } from "../../lib/mcp/mini-canvas-client";

type NotePickerDialogProps = {
  notes: VaultNoteEntry[];
  query: string;
  busy: boolean;
  loaded: boolean;
  onQueryChange(query: string): void;
  onOpen(path: string): void;
  onClose(): void;
};

export function NotePickerDialog({
  notes,
  query,
  busy,
  loaded,
  onQueryChange,
  onOpen,
  onClose,
}: NotePickerDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="canvas-dialog note-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-picker-title"
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-eyebrow">MCP · 隔离 Vault</span>
            <h2 id="note-picker-title">打开 Obsidian 笔记</h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label="关闭笔记列表"
          >
            ×
          </button>
        </header>
        <label className="note-search-field">
          <span className="sr-only">筛选笔记路径</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索文件夹或笔记名称…"
            autoFocus
          />
        </label>
        <div className="note-picker-meta">
          <span>{busy && !loaded ? "正在读取…" : `${notes.length} 篇笔记`}</span>
          <span>打开时创建加密草稿，不直接改写 Obsidian</span>
        </div>
        <ul className="note-list">
          {notes.map((entry) => (
            <li className="note-list-entry" key={entry.path}>
              <button
                type="button"
                className="note-list-item"
                onClick={() => onOpen(entry.path)}
                disabled={busy}
              >
                <span className="note-list-name">{titleFromVaultPath(entry.path)}</span>
                <span className="note-list-path">{entry.path}</span>
                <span className="note-list-size">
                  {Math.max(1, Math.round(entry.size / 1024))} KB
                </span>
              </button>
            </li>
          ))}
          {!busy && loaded && notes.length === 0 ? (
            <li className="note-list-empty">没有找到匹配的 Markdown 笔记。</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

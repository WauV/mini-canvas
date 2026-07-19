import type { McpNoticeValue } from "./types";

type McpNoticeProps = {
  notice: McpNoticeValue;
  onClose(): void;
};

export function McpNotice({ notice, onClose }: McpNoticeProps) {
  return (
    <div className={`mcp-notice mcp-notice-${notice.kind}`} role="status">
      <span>{notice.text}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示">
        ×
      </button>
    </div>
  );
}

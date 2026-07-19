import type { DocumentSnapshot } from "./types";

export function hasMeaningfulContent(document: DocumentSnapshot): boolean {
  return (
    document.content.trim().length > 0 ||
    (document.title.trim().length > 0 && document.title !== "未命名笔记")
  );
}

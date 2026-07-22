"use client";

import { useCallback, useMemo, useState } from "react";
import { Editor, type EditorMode } from "./components/Editor";
import { CanvasHeader } from "./components/canvas/CanvasHeader";
import { CanvasViewBar } from "./components/canvas/CanvasViewBar";
import { CommitPreviewDialog } from "./components/canvas/CommitPreviewDialog";
import { McpNotice } from "./components/canvas/McpNotice";
import { NotePickerDialog } from "./components/canvas/NotePickerDialog";
import { calculateDocumentStatistics } from "./lib/document-statistics";
import { hasMeaningfulContent } from "./lib/documents/document-helpers";
import type { SaveState } from "./lib/documents/document-persistence-state";
import { EXAMPLE_MARKDOWN } from "./lib/example-markdown";
import { DEFAULT_DOCUMENT_ID, type DocumentSnapshot } from "./lib/documents/types";
import { useDocumentPersistence } from "./lib/documents/use-document-persistence";
import { useMcpDraftSession } from "./lib/mcp/use-mcp-draft-session";

export type MiniCanvasProps = {
  hostMode?: "page" | "widget";
};

export function MiniCanvas({ hostMode = "page" }: MiniCanvasProps = {}) {
  const isWidget = hostMode === "widget";
  const { state: persistenceState, actions: documents } =
    useDocumentPersistence(isWidget);
  const {
    document,
    saveState,
    saveConflict,
    resolvingConflict,
    hasRecovery,
  } = persistenceState;
  const [editorMode, setEditorMode] = useState<EditorMode>("live");
  const startEditing = useCallback(() => setEditorMode("live"), []);
  const mcp = useMcpDraftSession({
    isWidget,
    documents,
    onStartEditing: startEditing,
  });
  const {
    draft: mcpDraft,
    busy: mcpBusy,
    notice: mcpNotice,
    setNotice: setMcpNotice,
    commitPreview,
    setCommitPreview,
    notePickerOpen,
    setNotePickerOpen,
    noteQuery,
    setNoteQuery,
    notesLoaded,
    filteredVaultNotes,
    livePreviewInteractions,
    showNotePicker,
    openVaultNote,
    previewCommit: previewMcpCommit,
    commitCurrentDraft: commitCurrentMcpDraft,
    requestFullscreen,
    prepareToLeave: prepareToLeaveMcpDraft,
    resetSession: resetMcpSession,
  } = mcp;

  const statistics = useMemo(
    () => calculateDocumentStatistics(document.content),
    [document.content],
  );

  const replaceDocument = async (
    title: string,
    content: string,
    confirmation: string,
  ) => {
    const current = documents.currentDocument();

    if (mcpDraft && !(await prepareToLeaveMcpDraft())) return;

    const repository = documents.localRepository();

    let storedDocument: DocumentSnapshot | null = null;
    if (repository) {
      const shouldBackup = hasMeaningfulContent(current);
      if (shouldBackup && !window.confirm(confirmation)) return;

      try {
        storedDocument = await repository.load(DEFAULT_DOCUMENT_ID);
        if (shouldBackup) {
          await repository.backup(current);
          documents.setRecoveryAvailable(true);
        }
      } catch {
        documents.reportError();
        return;
      }
    }
    const expectedVersion =
      storedDocument?.version ?? documents.currentDocument().version;
    if (repository) {
      documents.activate(
        repository,
        {
          ...current,
          id: DEFAULT_DOCUMENT_ID,
          title,
          content,
          version: expectedVersion,
          updatedAt: Date.now(),
        },
        { persisted: false, saveState: "saving" },
      );
    }
    /* Widget mode never calls this path; keep the state transition guarded by
       the local repository so an unavailable browser store cannot lose text. */
    if (!repository) return;
    resetMcpSession({ clearNotice: true });
    setEditorMode("live");
  };

  const startNewDocument = () => {
    void replaceDocument(
      "未命名笔记",
      "",
      "新建文档会替换当前内容。继续后会先把当前版本放入恢复槽，是否继续？",
    );
  };

  const loadExample = () => {
    void replaceDocument(
      "Mini Canvas 使用指南",
      EXAMPLE_MARKDOWN,
      "加载示例会替换当前内容。继续后会先把当前版本放入恢复槽，是否继续？",
    );
  };

  const restoreRecovery = () => {
    const repository = documents.localRepository();
    if (!repository) return;

    void (async () => {
      try {
        const recovery = await repository.loadRecovery();
        if (!recovery) {
          documents.setRecoveryAvailable(false);
          return;
        }

        if (
          hasMeaningfulContent(documents.currentDocument()) &&
          !window.confirm("用恢复版本替换当前内容？当前版本会进入恢复槽。")
        ) {
          return;
        }

        const current = documents.currentDocument();
        const storedDocument = await repository.load(DEFAULT_DOCUMENT_ID);
        const expectedVersion = storedDocument?.version ?? "0";
        await repository.backup(current);
        documents.activate(
          repository,
          {
            ...recovery,
            id: DEFAULT_DOCUMENT_ID,
            version: expectedVersion,
            updatedAt: Date.now(),
          },
          { persisted: false, saveState: "saving" },
        );
        setEditorMode("live");
        resetMcpSession();
        documents.setRecoveryAvailable(true);
      } catch {
        documents.reportError();
      }
    })();
  };

  const updateTitle = (title: string) => {
    if (mcpDraft || isWidget) return;
    documents.update({ title });
  };

  const updateContent = (content: string) => {
    if (mcpBusy) return;
    if (isWidget && !mcpDraft) return;
    if (mcpDraft?.status !== undefined && mcpDraft.status !== "active") return;
    documents.update({ content });
    setCommitPreview(null);
  };

  const overwriteStoredVersion = () => {
    documents.resolveConflict(
      "overwrite",
      "保留编辑器中的当前内容，并覆盖浏览器里较新的已保存版本？",
    );
  };

  const loadStoredVersion = () => {
    documents.resolveConflict(
      "reload",
      "载入浏览器中已经保存的版本？当前编辑器内容会先放入恢复槽。",
    );
  };

  const saveLabels: Record<SaveState, string> = {
    saved:
      mcpDraft?.status === "committed"
        ? "已提交到 Obsidian"
        : mcpDraft
          ? "已保存到加密草稿"
          : isWidget
            ? "等待选择笔记"
            : "已保存到本机",
    saving: "正在保存",
    error: "保存失败",
    conflict: "保存冲突",
  };

  return (
    <main className={`canvas-shell${isWidget ? " is-widget" : ""}`}>
      <CanvasHeader
        document={document}
        draft={mcpDraft}
        isWidget={isWidget}
        saveState={saveState}
        saveLabel={saveLabels[saveState]}
        saveConflict={saveConflict}
        resolvingConflict={resolvingConflict}
        hasRecovery={hasRecovery}
        busy={mcpBusy}
        onTitleChange={updateTitle}
        onKeepCurrent={overwriteStoredVersion}
        onLoadSaved={loadStoredVersion}
        onRestore={restoreRecovery}
        onNew={startNewDocument}
        onExample={loadExample}
        onFullscreen={requestFullscreen}
        onOpenNote={showNotePicker}
      />

      <CanvasViewBar
        mode={editorMode}
        isWidget={isWidget}
        draft={mcpDraft}
        busy={mcpBusy}
        hasSaveConflict={Boolean(saveConflict)}
        statistics={statistics}
        onModeChange={setEditorMode}
        onPreviewCommit={() => void previewMcpCommit()}
        onContinueEditing={(path) =>
          void openVaultNote(path, { skipConfirmation: true })
        }
      />

      <section
        className={"workspace editor-workspace mode-" + editorMode}
        aria-label="Obsidian Markdown 编辑器"
      >
        <Editor
          content={document.content}
          mode={editorMode}
          onChange={updateContent}
          livePreviewInteractions={livePreviewInteractions}
          readOnly={
            mcpBusy ||
            (isWidget && !mcpDraft) ||
            mcpDraft?.status === "committed" ||
            mcpDraft?.status === "expired"
          }
        />
      </section>

      {mcpNotice ? <McpNotice notice={mcpNotice} onClose={() => setMcpNotice(null)} /> : null}

      {notePickerOpen ? (
        <NotePickerDialog
          notes={filteredVaultNotes}
          query={noteQuery}
          busy={mcpBusy}
          loaded={notesLoaded}
          onQueryChange={setNoteQuery}
          onOpen={(path) => void openVaultNote(path)}
          onClose={() => setNotePickerOpen(false)}
        />
      ) : null}

      {commitPreview ? (
        <CommitPreviewDialog
          preview={commitPreview}
          busy={mcpBusy}
          onClose={() => setCommitPreview(null)}
          onCommit={() => void commitCurrentMcpDraft()}
        />
      ) : null}
    </main>
  );
}

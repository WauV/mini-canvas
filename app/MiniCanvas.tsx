"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor, type EditorMode } from "./components/Editor";
import { calculateDocumentStatistics } from "./lib/document-statistics";
import { LocalStorageDocumentRepository } from "./lib/documents/local-storage-repository";
import {
  McpDraftDocumentRepository,
  titleFromVaultPath,
} from "./lib/documents/mcp-draft-repository";
import { DocumentSaveQueue } from "./lib/documents/save-queue";
import {
  createDocumentSnapshot,
  createIdempotencyKey,
  DEFAULT_DOCUMENT_ID,
  DocumentConflictError,
  type DocumentRepository,
  type DocumentSnapshot,
} from "./lib/documents/types";
import {
  type CommitPreview,
  type DraftSnapshot,
  McpRevisionConflictError,
  MiniCanvasMcpClient,
  type VaultNoteEntry,
} from "./lib/mcp/mini-canvas-client";
import { createMcpToolClient } from "./lib/mcp/tool-client";

type SaveState = "saved" | "saving" | "error" | "conflict";
type SaveConflict = {
  expectedVersion: string;
  actualVersion: string;
};
type McpNotice = { kind: "info" | "error" | "success"; text: string };

const INLINE_CODE = String.fromCharCode(96);
const CODE_FENCE = INLINE_CODE.repeat(3);

const EXAMPLE_MARKDOWN = [
  "---",
  "tags:",
  "  - mini-canvas",
  "  - obsidian",
  "status: drafting",
  "---",
  "",
  "# 欢迎使用 Mini Canvas",
  "",
  "这是一个保持原始 Markdown 的 **Obsidian Live Preview** 编辑器。",
  "",
  "> 这是普通 Markdown 引用，会显示为引用块。",
  "",
  "> [!note] 原文保真",
  "> 页面只改变 Markdown 的显示方式，不会把笔记转换成另一种格式。",
  "",
  "## Obsidian 语法",
  "",
  "- [x] Wiki Link：[[知识库/示例笔记|示例笔记]]",
  "- [ ] 嵌入内容：![[附件/示意图.png]]",
  "- [ ] 标签：#写作/实验",
  "- [ ] 高亮：==这段内容很重要==",
  "",
  "这是一段带编号脚注的内容[^1]，也支持^[直接写在段落里的行内脚注]。",
  "",
  "[^1]: 脚注定义仍然保存在原始 Markdown 中。",
  "",
  "## 数学公式",
  "",
  "行内公式会自然地出现在段落中，例如 $E = mc^2$。",
  "",
  "$$",
  "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
  "$$",
  "",
  "矩阵同样可以渲染：",
  "",
  "$$",
  "\\begin{bmatrix}",
  "a & b \\\\",
  "c & d",
  "\\end{bmatrix}",
  "$$",
  "",
  "## SVG 图形",
  "",
  "下面的源码仍保存在笔记中，Live Preview 会把它显示为安全的图片预览：",
  "",
  CODE_FENCE + "svg",
  '<svg viewBox="0 0 360 120" role="img" aria-label="Mini Canvas SVG 示例">',
  '  <rect width="360" height="120" rx="24" fill="#f4e2d6" />',
  '  <circle cx="64" cy="60" r="28" fill="#d97757" />',
  '  <path d="M112 60 H308" stroke="#75422f" stroke-width="8" stroke-linecap="round" />',
  "</svg>",
  CODE_FENCE,
  "",
  "## 表格",
  "",
  "| 功能 | 状态 |",
  "| --- | --- |",
  "| Markdown 原文 | 保留 |",
  "| Obsidian 语法 | Live Preview |",
  "| 引用、脚注与 Callout | 支持 |",
  "| LaTeX | KaTeX 渲染 |",
  "",
  "## 代码",
  "",
  CODE_FENCE + "ts",
  "const canvas = {",
  '  name: "Mini Canvas",',
  "  ready: true,",
  "};",
  CODE_FENCE,
  "",
  "这段内容可以被其他笔记引用。 ^mini-canvas-demo",
  "",
  "%%这是一条 Obsidian 注释，Live Preview 中会折叠显示。%%",
  "",
].join("\n");

const INITIAL_DOCUMENT = createDocumentSnapshot(
  "我的第一篇笔记",
  EXAMPLE_MARKDOWN,
);

function hasMeaningfulContent(document: DocumentSnapshot): boolean {
  return (
    document.content.trim().length > 0 ||
    (document.title.trim().length > 0 && document.title !== "未命名笔记")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "MCP 草稿操作失败";
}

export function MiniCanvas() {
  const [document, setDocument] = useState<DocumentSnapshot>(INITIAL_DOCUMENT);
  const [editorMode, setEditorMode] = useState<EditorMode>("live");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [ready, setReady] = useState(false);
  const [mcpDraft, setMcpDraft] = useState<DraftSnapshot | null>(null);
  const [vaultNotes, setVaultNotes] = useState<VaultNoteEntry[]>([]);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [noteQuery, setNoteQuery] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpNotice, setMcpNotice] = useState<McpNotice | null>(null);
  const [commitPreview, setCommitPreview] = useState<CommitPreview | null>(null);
  const repositoryRef = useRef<DocumentRepository | null>(null);
  const localRepositoryRef = useRef<LocalStorageDocumentRepository | null>(null);
  const mcpRepositoryRef = useRef<McpDraftDocumentRepository | null>(null);
  const mcpClientRef = useRef<MiniCanvasMcpClient | null>(null);
  const documentRef = useRef(document);
  const versionRef = useRef(document.version);
  const saveConflictRef = useRef<SaveConflict | null>(null);
  const saveQueueRef = useRef(new DocumentSaveQueue());
  const conflictResolutionInFlightRef = useRef(false);
  const persistedContentRef = useRef<{
    title: string;
    content: string;
  } | null>(null);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  const updateSaveConflict = useCallback((conflict: SaveConflict | null) => {
    saveConflictRef.current = conflict;
    setSaveConflict(conflict);
  }, []);

  const getMcpClient = useCallback((): MiniCanvasMcpClient => {
    mcpClientRef.current ??= new MiniCanvasMcpClient(createMcpToolClient());
    return mcpClientRef.current;
  }, []);

  const persistSnapshot = useCallback(
    async (
      repository: DocumentRepository,
      pendingDocument: DocumentSnapshot,
      expectedVersion: string,
    ): Promise<void> => {
      try {
        const savedDocument = await repository.save(
          { ...pendingDocument, version: expectedVersion },
          {
            expectedVersion,
            idempotencyKey: createIdempotencyKey(),
          },
        );
        persistedContentRef.current = {
          title: pendingDocument.title,
          content: pendingDocument.content,
        };
        versionRef.current = savedDocument.version;
        setDocument((current) => ({
          ...current,
          version: savedDocument.version,
          updatedAt: savedDocument.updatedAt,
        }));
        updateSaveConflict(null);

        const current = documentRef.current;
        if (
          current.title === pendingDocument.title &&
          current.content === pendingDocument.content
        ) {
          setSaveState("saved");
        }
      } catch (error: unknown) {
        if (error instanceof DocumentConflictError) {
          updateSaveConflict({
            expectedVersion: error.expectedVersion,
            actualVersion: error.actualVersion,
          });
          setSaveState("conflict");
        } else {
          setSaveState("error");
        }
      }
    },
    [updateSaveConflict],
  );

  const enqueuePersist = useCallback(
    (
      repository: DocumentRepository,
      options: {
        expectedVersion?: string;
        pendingDocument?: DocumentSnapshot;
        resolveConflict?: boolean;
      } = {},
    ): Promise<void> =>
      saveQueueRef.current.run(async () => {
        if (saveConflictRef.current && !options.resolveConflict) return;

        const pendingDocument = options.pendingDocument ?? documentRef.current;
        const persistedContent = persistedContentRef.current;
        if (
          !options.resolveConflict &&
          persistedContent?.title === pendingDocument.title &&
          persistedContent.content === pendingDocument.content
        ) {
          setSaveState("saved");
          return;
        }

        await persistSnapshot(
          repository,
          pendingDocument,
          options.expectedVersion ?? versionRef.current,
        );
      }),
    [persistSnapshot],
  );

  useEffect(() => {
    let active = true;
    const repository = new LocalStorageDocumentRepository(window.localStorage);
    localRepositoryRef.current = repository;
    repositoryRef.current = repository;

    void Promise.all([
      repository.load(DEFAULT_DOCUMENT_ID),
      repository.loadRecovery(),
    ]).then(([storedDocument, recovery]) => {
      if (!active) return;
      const initialDocument = storedDocument ?? INITIAL_DOCUMENT;
      persistedContentRef.current = storedDocument
        ? { title: storedDocument.title, content: storedDocument.content }
        : null;
      versionRef.current = initialDocument.version;
      setDocument(initialDocument);
      setHasRecovery(recovery !== null);
      setReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      mcpClientRef.current?.close();
    },
    [],
  );

  useEffect(() => {
    if (!ready || saveConflict) return;
    const repository = repositoryRef.current;
    if (!repository) return;

    const pendingDocument = documentRef.current;
    const persistedContent = persistedContentRef.current;
    if (
      persistedContent?.title === pendingDocument.title &&
      persistedContent.content === pendingDocument.content
    ) {
      setSaveState("saved");
      return;
    }
    const timer = window.setTimeout(() => {
      void enqueuePersist(repository);
    }, 320);

    return () => window.clearTimeout(timer);
  }, [document.content, document.title, enqueuePersist, ready, saveConflict]);

  const statistics = useMemo(
    () => calculateDocumentStatistics(document.content),
    [document.content],
  );

  const filteredVaultNotes = useMemo(() => {
    const query = noteQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return vaultNotes;
    return vaultNotes.filter((entry) =>
      entry.path.toLocaleLowerCase("zh-CN").includes(query),
    );
  }, [noteQuery, vaultNotes]);

  const showNotePicker = () => {
    setNotePickerOpen(true);
    setMcpNotice(null);
    if (notesLoaded || mcpBusy) return;

    setMcpBusy(true);
    void getMcpClient()
      .listNotes()
      .then((entries) => {
        setVaultNotes(entries);
        setNotesLoaded(true);
      })
      .catch((error: unknown) => {
        setMcpNotice({ kind: "error", text: errorMessage(error) });
      })
      .finally(() => setMcpBusy(false));
  };

  const openVaultNote = async (
    path: string,
    options: { skipConfirmation?: boolean } = {},
  ): Promise<void> => {
    if (mcpBusy) return;
    const current = { ...documentRef.current, version: versionRef.current };
    if (
      !options.skipConfirmation &&
      hasMeaningfulContent(current) &&
      !window.confirm(
        "打开 Obsidian 笔记会切换当前编辑器。当前本地内容会进入恢复槽，MCP 草稿会先保存，是否继续？",
      )
    ) {
      return;
    }

    setMcpBusy(true);
    setMcpNotice({ kind: "info", text: "正在创建加密草稿…" });
    try {
      const currentMcpRepository = mcpRepositoryRef.current;
      if (currentMcpRepository) {
        await enqueuePersist(currentMcpRepository);
        if (saveConflictRef.current) {
          throw new Error("请先解决当前草稿的保存冲突");
        }
      } else if (hasMeaningfulContent(current)) {
        await localRepositoryRef.current?.backup(current);
        setHasRecovery(true);
      }

      const client = getMcpClient();
      const draft = await client.createDraft(path);
      const repository = new McpDraftDocumentRepository({
        client,
        draft,
        recovery: localRepositoryRef.current ??
          new LocalStorageDocumentRepository(window.localStorage),
        onDraftChange: setMcpDraft,
      });
      const nextDocument: DocumentSnapshot = {
        id: draft.id,
        title: titleFromVaultPath(draft.path),
        content: draft.content,
        version: String(draft.version),
        updatedAt: draft.updatedAt,
      };

      repositoryRef.current = repository;
      mcpRepositoryRef.current = repository;
      versionRef.current = nextDocument.version;
      documentRef.current = nextDocument;
      persistedContentRef.current = {
        title: nextDocument.title,
        content: nextDocument.content,
      };
      setDocument(nextDocument);
      setMcpDraft(draft);
      setCommitPreview(null);
      updateSaveConflict(null);
      setSaveState("saved");
      setEditorMode("live");
      setNotePickerOpen(false);
      setMcpNotice({
        kind: "success",
        text: `已打开加密草稿 · ${draft.path}`,
      });
    } catch (error) {
      setMcpNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setMcpBusy(false);
    }
  };

  const previewMcpCommit = async (): Promise<void> => {
    const repository = mcpRepositoryRef.current;
    if (!repository || mcpBusy || mcpDraft?.status !== "active") return;

    setMcpBusy(true);
    setMcpNotice({ kind: "info", text: "正在保存草稿并生成提交预览…" });
    try {
      await enqueuePersist(repository);
      if (saveConflictRef.current) throw new Error("请先解决草稿保存冲突");
      const preview = await repository.previewCommit(versionRef.current);
      setCommitPreview(preview);
      setMcpNotice({
        kind: preview.changed ? "info" : "success",
        text: preview.changed ? "提交预览已生成" : "当前草稿没有需要提交的变化",
      });
    } catch (error) {
      setMcpNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setMcpBusy(false);
    }
  };

  const commitCurrentMcpDraft = async (): Promise<void> => {
    const repository = mcpRepositoryRef.current;
    if (!repository || !commitPreview || !commitPreview.changed || mcpBusy) return;
    if (commitPreview.version !== Number(versionRef.current)) {
      setCommitPreview(null);
      setMcpNotice({ kind: "error", text: "草稿已经变化，请重新生成提交预览" });
      return;
    }

    setMcpBusy(true);
    setMcpNotice({ kind: "info", text: "正在安全提交到 Obsidian…" });
    try {
      const result = await repository.commit(
        versionRef.current,
        createIdempotencyKey(),
      );
      versionRef.current = String(result.draft.version);
      const nextDocument = {
        ...documentRef.current,
        version: String(result.draft.version),
        updatedAt: result.draft.updatedAt,
      };
      documentRef.current = nextDocument;
      setDocument(nextDocument);
      setMcpDraft(result.draft);
      setCommitPreview(null);
      setSaveState("saved");
      setMcpNotice({
        kind: "success",
        text: `已提交到 Obsidian · revision ${result.note.revision}`,
      });
    } catch (error) {
      setMcpNotice({
        kind: "error",
        text:
          error instanceof McpRevisionConflictError
            ? "Obsidian 笔记已经变化；草稿仍然安全保留，未覆盖新内容"
            : errorMessage(error),
      });
    } finally {
      setMcpBusy(false);
    }
  };

  const replaceDocument = async (
    title: string,
    content: string,
    confirmation: string,
  ) => {
    const current = {
      ...documentRef.current,
      version: versionRef.current,
    };

    // If there is an active MCP draft and the user is switching away, save it
    // first or warn that it will be abandoned.
    const activeMcpRepository = mcpRepositoryRef.current;
    if (activeMcpRepository) {
      await enqueuePersist(activeMcpRepository);
      if (saveConflictRef.current) {
        setMcpNotice({ kind: "error", text: "请先解决当前草稿的保存冲突再切换" });
        return;
      }
    }

    const repository = localRepositoryRef.current ?? repositoryRef.current;

    let storedDocument: DocumentSnapshot | null = null;
    if (repository) {
      const shouldBackup = hasMeaningfulContent(current);
      if (shouldBackup && !window.confirm(confirmation)) return;

      try {
        storedDocument = await repository.load(DEFAULT_DOCUMENT_ID);
        if (shouldBackup) {
          await repository.backup(current);
          setHasRecovery(true);
        }
      } catch {
        setSaveState("error");
        return;
      }
    }
    const expectedVersion = storedDocument?.version ?? versionRef.current;
    if (repository) repositoryRef.current = repository;
    mcpRepositoryRef.current = null;
    versionRef.current = expectedVersion;

    setDocument((latest) => ({
      ...latest,
      title,
      content,
      version: expectedVersion,
      updatedAt: Date.now(),
    }));
    updateSaveConflict(null);
    setMcpDraft(null);
    setCommitPreview(null);
    setMcpNotice(null);
    setEditorMode("live");
    setSaveState("saving");
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
    const repository = localRepositoryRef.current;
    if (!repository) return;

    void (async () => {
      try {
        const recovery = await repository.loadRecovery();
        if (!recovery) {
          setHasRecovery(false);
          return;
        }

        if (
          hasMeaningfulContent(documentRef.current) &&
          !window.confirm("用恢复版本替换当前内容？当前版本会进入恢复槽。")
        ) {
          return;
        }

        const current = {
          ...documentRef.current,
          version: versionRef.current,
        };
        const storedDocument = await repository.load(DEFAULT_DOCUMENT_ID);
        const expectedVersion = storedDocument?.version ?? "0";
        await repository.backup(current);
        versionRef.current = expectedVersion;
        repositoryRef.current = repository;
        mcpRepositoryRef.current = null;
        setDocument((latest) => ({
          ...latest,
          title: recovery.title,
          content: recovery.content,
          version: expectedVersion,
          updatedAt: Date.now(),
        }));
        setEditorMode("live");
        setSaveState("saving");
        updateSaveConflict(null);
        setMcpDraft(null);
        setCommitPreview(null);
        setHasRecovery(true);
      } catch {
        setSaveState("error");
      }
    })();
  };

  const updateTitle = (title: string) => {
    if (mcpDraft) return;
    const next = { ...documentRef.current, title };
    documentRef.current = next;
    setDocument(next);
    setSaveState(saveConflictRef.current ? "conflict" : "saving");
  };

  const updateContent = (content: string) => {
    if (mcpDraft?.status !== undefined && mcpDraft.status !== "active") return;
    const next = { ...documentRef.current, content };
    documentRef.current = next;
    setDocument(next);
    setCommitPreview(null);
    setSaveState(saveConflictRef.current ? "conflict" : "saving");
  };

  const overwriteStoredVersion = () => {
    const repository = repositoryRef.current;
    if (
      !repository ||
      !saveConflict ||
      conflictResolutionInFlightRef.current ||
      !window.confirm(
        "保留编辑器中的当前内容，并覆盖浏览器里较新的已保存版本？",
      )
    ) {
      return;
    }

    conflictResolutionInFlightRef.current = true;
    setResolvingConflict(true);
    void (async () => {
      try {
        const latest = await repository.load(DEFAULT_DOCUMENT_ID);
        if (!latest) throw new Error("找不到已保存版本。");
        versionRef.current = latest.version;
        const pending = {
          ...documentRef.current,
          version: latest.version,
        };
        setDocument((current) => ({
          ...current,
          version: latest.version,
        }));
        setSaveState("saving");
        await enqueuePersist(repository, {
          expectedVersion: latest.version,
          pendingDocument: pending,
          resolveConflict: true,
        });
      } catch {
        setSaveState("error");
      } finally {
        conflictResolutionInFlightRef.current = false;
        setResolvingConflict(false);
      }
    })();
  };

  const loadStoredVersion = () => {
    const repository = repositoryRef.current;
    if (
      !repository ||
      !saveConflict ||
      conflictResolutionInFlightRef.current ||
      !window.confirm(
        "载入浏览器中已经保存的版本？当前编辑器内容会先放入恢复槽。",
      )
    ) {
      return;
    }

    conflictResolutionInFlightRef.current = true;
    setResolvingConflict(true);
    void (async () => {
      try {
        const latest = await repository.load(DEFAULT_DOCUMENT_ID);
        if (!latest) throw new Error("找不到已保存版本。");
        await repository.backup({
          ...documentRef.current,
          version: versionRef.current,
        });
        versionRef.current = latest.version;
        persistedContentRef.current = {
          title: latest.title,
          content: latest.content,
        };
        setDocument(latest);
        setHasRecovery(true);
        updateSaveConflict(null);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      } finally {
        conflictResolutionInFlightRef.current = false;
        setResolvingConflict(false);
      }
    })();
  };

  const saveLabels: Record<SaveState, string> = {
    saved:
      mcpDraft?.status === "committed"
        ? "已提交到 Obsidian"
        : mcpDraft
          ? "已保存到加密草稿"
          : "已保存到本机",
    saving: "正在保存",
    error: "保存失败",
    conflict: "保存冲突",
  };

  return (
    <main className="canvas-shell">
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
            onChange={(event) => updateTitle(event.target.value)}
            readOnly={Boolean(mcpDraft)}
            placeholder="未命名笔记"
            aria-label="文档标题"
            title={mcpDraft?.path}
          />
        </label>

        <div className="header-actions">
          <span
            className={"save-state save-state-" + saveState}
            aria-live="polite"
            title={
              saveConflict
                ? "期望版本：" +
                  saveConflict.expectedVersion +
                  "；当前版本：" +
                  saveConflict.actualVersion
                : undefined
            }
          >
            <span className="save-dot" aria-hidden="true" />
            {saveLabels[saveState]}
          </span>
          {saveConflict ? (
            <div className="conflict-actions" aria-label="解决保存冲突">
              <button
                className="conflict-action"
                type="button"
                onClick={overwriteStoredVersion}
                disabled={resolvingConflict}
              >
                保留当前
              </button>
              <button
                className="conflict-action"
                type="button"
                onClick={loadStoredVersion}
                disabled={resolvingConflict}
              >
                载入已保存
              </button>
            </div>
          ) : null}
          {hasRecovery ? (
            <button
              className="secondary-button header-action-recovery"
              type="button"
              onClick={restoreRecovery}
            >
              恢复
            </button>
          ) : null}
          <button
            className="secondary-button header-action-new"
            type="button"
            onClick={startNewDocument}
          >
            新建
          </button>
          <button
            className="secondary-button header-action-example"
            type="button"
            onClick={loadExample}
          >
            示例
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={showNotePicker}
            disabled={mcpBusy}
          >
            打开笔记
          </button>
        </div>
      </header>

      <nav className="view-bar" aria-label="视图控制">
        <div className="view-switch" role="group" aria-label="选择工作区视图">
          <button
            type="button"
            className={editorMode === "live" ? "is-active" : ""}
            aria-pressed={editorMode === "live"}
            onClick={() => setEditorMode("live")}
          >
            Live Preview
          </button>
          <button
            type="button"
            className={editorMode === "source" ? "is-active" : ""}
            aria-pressed={editorMode === "source"}
            onClick={() => setEditorMode("source")}
          >
            Markdown 源码
          </button>
        </div>
        <div className="view-bar-meta">
          <p>
            <span aria-hidden="true">◇</span>
            {mcpDraft
              ? `${mcpDraft.path} · 草稿 v${mcpDraft.version}`
              : "Obsidian Markdown · 本地预览"}
          </p>
          {mcpDraft ? (
            <div className="mcp-draft-actions" aria-label="MCP 草稿操作">
              {mcpDraft.status === "active" ? (
                <button
                  type="button"
                  className="draft-action"
                  onClick={() => void previewMcpCommit()}
                  disabled={mcpBusy || Boolean(saveConflict)}
                >
                  预览提交
                </button>
              ) : (
                <button
                  type="button"
                  className="draft-action"
                  onClick={() =>
                    void openVaultNote(mcpDraft.path, { skipConfirmation: true })
                  }
                  disabled={mcpBusy}
                >
                  继续编辑
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

      <section
        className={"workspace editor-workspace mode-" + editorMode}
        aria-label="Obsidian Markdown 编辑器"
      >
        <Editor
          content={document.content}
          mode={editorMode}
          onChange={updateContent}
          readOnly={mcpDraft?.status === "committed" || mcpDraft?.status === "expired"}
        />
      </section>

      {mcpNotice ? (
        <div className={`mcp-notice mcp-notice-${mcpNotice.kind}`} role="status">
          <span>{mcpNotice.text}</span>
          <button type="button" onClick={() => setMcpNotice(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      ) : null}

      {notePickerOpen ? (
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
                onClick={() => setNotePickerOpen(false)}
                aria-label="关闭笔记列表"
              >
                ×
              </button>
            </header>
            <label className="note-search-field">
              <span className="sr-only">筛选笔记路径</span>
              <input
                value={noteQuery}
                onChange={(event) => setNoteQuery(event.target.value)}
                placeholder="搜索文件夹或笔记名称…"
                autoFocus
              />
            </label>
            <div className="note-picker-meta">
              <span>{mcpBusy && !notesLoaded ? "正在读取…" : `${filteredVaultNotes.length} 篇笔记`}</span>
              <span>打开时创建加密草稿，不直接改写 Obsidian</span>
            </div>
            <div className="note-list" role="list">
              {filteredVaultNotes.map((entry) => (
                <button
                  type="button"
                  className="note-list-item"
                  role="listitem"
                  key={entry.path}
                  onClick={() => void openVaultNote(entry.path)}
                  disabled={mcpBusy}
                >
                  <span className="note-list-name">{titleFromVaultPath(entry.path)}</span>
                  <span className="note-list-path">{entry.path}</span>
                  <span className="note-list-size">
                    {Math.max(1, Math.round(entry.size / 1024))} KB
                  </span>
                </button>
              ))}
              {!mcpBusy && notesLoaded && filteredVaultNotes.length === 0 ? (
                <p className="note-list-empty">没有找到匹配的 Markdown 笔记。</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {commitPreview ? (
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
                onClick={() => setCommitPreview(null)}
                aria-label="关闭提交预览"
              >
                ×
              </button>
            </header>
            <dl className="commit-summary">
              <div>
                <dt>笔记</dt>
                <dd>{commitPreview.path}</dd>
              </div>
              <div>
                <dt>字符变化</dt>
                <dd>{commitPreview.characterDelta >= 0 ? "+" : ""}{commitPreview.characterDelta}</dd>
              </div>
              <div>
                <dt>行数变化</dt>
                <dd>{commitPreview.lineDelta >= 0 ? "+" : ""}{commitPreview.lineDelta}</dd>
              </div>
              <div>
                <dt>基线 revision</dt>
                <dd>{commitPreview.baseRevision}</dd>
              </div>
            </dl>
            <p className="commit-hash">
              内容摘要 · {commitPreview.contentSha256.slice(0, 16)}…
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCommitPreview(null)}
              >
                返回编辑
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void commitCurrentMcpDraft()}
                disabled={!commitPreview.changed || mcpBusy}
              >
                {commitPreview.changed ? "正式提交" : "没有变化"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

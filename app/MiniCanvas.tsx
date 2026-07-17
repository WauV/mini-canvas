"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor, type EditorMode } from "./components/Editor";
import { calculateDocumentStatistics } from "./lib/document-statistics";
import { LocalStorageDocumentRepository } from "./lib/documents/local-storage-repository";
import {
  createDocumentSnapshot,
  createIdempotencyKey,
  DEFAULT_DOCUMENT_ID,
  DocumentConflictError,
  type DocumentRepository,
  type DocumentSnapshot,
} from "./lib/documents/types";

type SaveState = "saved" | "saving" | "error" | "conflict";
type SaveConflict = {
  expectedVersion: string;
  actualVersion: string;
};

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

export function MiniCanvas() {
  const [document, setDocument] = useState<DocumentSnapshot>(INITIAL_DOCUMENT);
  const [editorMode, setEditorMode] = useState<EditorMode>("live");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [ready, setReady] = useState(false);
  const repositoryRef = useRef<DocumentRepository | null>(null);
  const documentRef = useRef(document);
  const versionRef = useRef(document.version);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

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
        versionRef.current = savedDocument.version;
        setDocument((current) => ({
          ...current,
          version: savedDocument.version,
          updatedAt: savedDocument.updatedAt,
        }));
        setSaveConflict(null);

        const current = documentRef.current;
        if (
          current.title === pendingDocument.title &&
          current.content === pendingDocument.content
        ) {
          setSaveState("saved");
        }
      } catch (error: unknown) {
        if (error instanceof DocumentConflictError) {
          setSaveConflict({
            expectedVersion: error.expectedVersion,
            actualVersion: error.actualVersion,
          });
          setSaveState("conflict");
        } else {
          setSaveState("error");
        }
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const repository = new LocalStorageDocumentRepository(window.localStorage);
    repositoryRef.current = repository;

    void Promise.all([
      repository.load(DEFAULT_DOCUMENT_ID),
      repository.loadRecovery(),
    ]).then(([storedDocument, recovery]) => {
      if (!active) return;
      const initialDocument = storedDocument ?? INITIAL_DOCUMENT;
      versionRef.current = initialDocument.version;
      setDocument(initialDocument);
      setHasRecovery(recovery !== null);
      setReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const repository = repositoryRef.current;
    if (!repository) return;

    const pendingDocument = documentRef.current;
    const timer = window.setTimeout(() => {
      const expectedVersion = versionRef.current;
      void persistSnapshot(repository, pendingDocument, expectedVersion);
    }, 320);

    return () => window.clearTimeout(timer);
  }, [document.content, document.title, persistSnapshot, ready]);

  const statistics = useMemo(
    () => calculateDocumentStatistics(document.content),
    [document.content],
  );

  const replaceDocument = async (
    title: string,
    content: string,
    confirmation: string,
  ) => {
    const repository = repositoryRef.current;
    const current = {
      ...documentRef.current,
      version: versionRef.current,
    };

    if (repository && hasMeaningfulContent(current)) {
      if (!window.confirm(confirmation)) return;

      try {
        await repository.backup(current);
        setHasRecovery(true);
      } catch {
        setSaveState("error");
        return;
      }
    }

    const storedDocument = repository
      ? await repository.load(DEFAULT_DOCUMENT_ID)
      : null;
    const expectedVersion = storedDocument?.version ?? versionRef.current;
    versionRef.current = expectedVersion;

    setDocument((latest) => ({
      ...latest,
      title,
      content,
      version: expectedVersion,
      updatedAt: Date.now(),
    }));
    setSaveConflict(null);
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
    const repository = repositoryRef.current;
    if (!repository) return;

    void repository.loadRecovery().then(async (recovery) => {
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
      await repository.backup(current);
      const storedDocument = await repository.load(DEFAULT_DOCUMENT_ID);
      const expectedVersion = storedDocument?.version ?? "0";
      versionRef.current = expectedVersion;
      setDocument((latest) => ({
        ...latest,
        title: recovery.title,
        content: recovery.content,
        version: expectedVersion,
        updatedAt: Date.now(),
      }));
      setEditorMode("live");
      setSaveState("saving");
      setSaveConflict(null);
      setHasRecovery(true);
    });
  };

  const updateTitle = (title: string) => {
    setDocument((current) => ({ ...current, title }));
    setSaveState("saving");
  };

  const updateContent = (content: string) => {
    setDocument((current) => ({ ...current, content }));
    setSaveState("saving");
  };

  const overwriteStoredVersion = () => {
    const repository = repositoryRef.current;
    if (
      !repository ||
      !saveConflict ||
      !window.confirm(
        "保留编辑器中的当前内容，并覆盖浏览器里较新的已保存版本？",
      )
    ) {
      return;
    }

    void repository
      .load(DEFAULT_DOCUMENT_ID)
      .then(async (latest) => {
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
        setSaveConflict(null);
        setSaveState("saving");
        await persistSnapshot(repository, pending, latest.version);
      })
      .catch(() => setSaveState("error"));
  };

  const loadStoredVersion = () => {
    const repository = repositoryRef.current;
    if (
      !repository ||
      !saveConflict ||
      !window.confirm(
        "载入浏览器中已经保存的版本？当前编辑器内容会先放入恢复槽。",
      )
    ) {
      return;
    }

    void repository
      .load(DEFAULT_DOCUMENT_ID)
      .then(async (latest) => {
        if (!latest) throw new Error("找不到已保存版本。");
        await repository.backup({
          ...documentRef.current,
          version: versionRef.current,
        });
        versionRef.current = latest.version;
        setDocument(latest);
        setHasRecovery(true);
        setSaveConflict(null);
        setSaveState("saved");
      })
      .catch(() => setSaveState("error"));
  };

  const saveLabels: Record<SaveState, string> = {
    saved: "已保存到本机",
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
            placeholder="未命名笔记"
            aria-label="文档标题"
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
              >
                保留当前
              </button>
              <button
                className="conflict-action"
                type="button"
                onClick={loadStoredVersion}
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
            className="primary-button"
            type="button"
            onClick={loadExample}
          >
            示例
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
            Obsidian Markdown · 原文保真
          </p>
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
        />
      </section>
    </main>
  );
}

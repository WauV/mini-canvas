"use client";

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { useCallback, useEffect, useRef } from "react";
import {
  applyEditorAction,
  type EditorAction,
  type TextEdit,
} from "../lib/editor-actions";
import { createObsidianLivePreview } from "../lib/live-preview";
import type { LivePreviewInteractions } from "../lib/obsidian-interactions";

export type EditorMode = "live" | "source";

type EditorProps = {
  content: string;
  mode: EditorMode;
  onChange: (content: string) => void;
  readOnly?: boolean;
  livePreviewInteractions?: LivePreviewInteractions;
};

type ToolbarItem = {
  action: EditorAction;
  label: string;
  glyph: string;
  shortcut?: string;
};

const TOOLBAR_GROUPS: ToolbarItem[][] = [
  [
    { action: "heading", label: "二级标题", glyph: "H₂" },
    { action: "bold", label: "粗体", glyph: "B", shortcut: "Ctrl+B" },
    { action: "italic", label: "斜体", glyph: "I", shortcut: "Ctrl+I" },
    { action: "highlight", label: "Obsidian 高亮", glyph: "==" },
  ],
  [
    { action: "quote", label: "引用", glyph: "❝" },
    { action: "bullet", label: "项目列表", glyph: "•" },
    { action: "checklist", label: "任务列表", glyph: "☑" },
    { action: "callout", label: "Obsidian Callout", glyph: "!" },
  ],
  [
    { action: "inline-code", label: "行内代码", glyph: "<>" },
    { action: "code-block", label: "代码块", glyph: "{ }" },
    { action: "link", label: "网页链接", glyph: "↗", shortcut: "Ctrl+K" },
    { action: "wikilink", label: "Obsidian Wiki Link", glyph: "[[" },
    { action: "footnote", label: "Obsidian 脚注", glyph: "¹" },
  ],
  [
    { action: "inline-math", label: "行内公式", glyph: "∑" },
    { action: "block-math", label: "块级公式", glyph: "ƒ(x)" },
  ],
];

function minimalChange(
  previousValue: string,
  nextValue: string,
): { from: number; to: number; insert: string } | null {
  if (previousValue === nextValue) return null;

  // This computes the smallest single contiguous replacement. Repeated text
  // may allow several equally valid edits, but the resulting document and
  // CodeMirror transaction remain deterministic.
  let prefix = 0;
  const shortestLength = Math.min(previousValue.length, nextValue.length);
  while (
    prefix < shortestLength &&
    previousValue[prefix] === nextValue[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previousValue.length - prefix &&
    suffix < nextValue.length - prefix &&
    previousValue[previousValue.length - 1 - suffix] ===
      nextValue[nextValue.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    from: prefix,
    to: previousValue.length - suffix,
    insert: nextValue.slice(prefix, nextValue.length - suffix),
  };
}

function dispatchTextEdit(view: EditorView, edit: TextEdit): void {
  const currentValue = view.state.doc.toString();
  const changes = minimalChange(currentValue, edit.value);
  if (!changes) return;

  view.dispatch({
    changes,
    selection: {
      anchor: edit.selectionStart,
      head: edit.selectionEnd,
    },
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

function runEditorAction(
  view: EditorView,
  action: EditorAction,
): boolean {
  const selection = view.state.selection.main;
  const edit = applyEditorAction(
    view.state.doc.toString(),
    selection.from,
    selection.to,
    action,
  );
  dispatchTextEdit(view, edit);
  return true;
}

const NO_LIVE_PREVIEW_INTERACTIONS: LivePreviewInteractions = {};

function modeExtensions(
  mode: EditorMode,
  interactions: LivePreviewInteractions,
): Extension {
  return mode === "live"
    ? [createObsidianLivePreview(undefined, interactions)]
    : [lineNumbers(), EditorView.contentAttributes.of({ "data-mode": "source" })];
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-text)",
  },
  ".cm-content": {
    maxWidth: "872px",
    minHeight: "100%",
    margin: "0 auto",
    padding: "44px 56px 100px",
    caretColor: "var(--accent)",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent)",
    borderLeftWidth: "2px",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--selection-background)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-gutter)",
    borderRight: "1px solid var(--line)",
    color: "var(--text-faint)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--surface-active-line)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--surface-active-gutter)",
    color: "var(--accent)",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

export function Editor({
  content,
  mode,
  onChange,
  readOnly = false,
  livePreviewInteractions = NO_LIVE_PREVIEW_INTERACTIONS,
}: EditorProps) {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialContentRef = useRef(content);
  const initialModeRef = useRef(mode);
  const initialInteractionsRef = useRef(livePreviewInteractions);
  const initialReadOnlyRef = useRef(readOnly);
  const modeCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = editorHostRef.current;
    if (!parent) return;

    const state = EditorState.create({
      doc: initialContentRef.current,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        indentUnit.of("  "),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        placeholder("在这里输入 Markdown、Wiki Link 或 LaTeX…"),
        EditorView.contentAttributes.of({
          "aria-label": "Markdown 内容",
          autocapitalize: "sentences",
          spellcheck: "false",
        }),
        keymap.of([
          {
            key: "Mod-b",
            run: (view) => runEditorAction(view, "bold"),
          },
          {
            key: "Mod-i",
            run: (view) => runEditorAction(view, "italic"),
          },
          {
            key: "Mod-k",
            run: (view) => runEditorAction(view, "link"),
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        editorTheme,
        modeCompartmentRef.current.of(
          modeExtensions(
            initialModeRef.current,
            initialInteractionsRef.current,
          ),
        ),
        readOnlyCompartmentRef.current.of([
          EditorState.readOnly.of(initialReadOnlyRef.current),
          EditorView.editable.of(!initialReadOnlyRef.current),
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue === content) return;

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: content,
      },
      selection: { anchor: 0 },
      scrollIntoView: true,
    });
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: modeCompartmentRef.current.reconfigure(
        modeExtensions(mode, livePreviewInteractions),
      ),
    });
  }, [livePreviewInteractions, mode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  const runAction = useCallback((action: EditorAction) => {
    const view = viewRef.current;
    if (view) runEditorAction(view, action);
  }, []);

  return (
    <article
      className={
        "workspace-panel editor-panel editor-mode-" +
        mode +
        (readOnly ? " editor-read-only" : "")
      }
    >
      <div className="editor-toolbar" role="toolbar" aria-label="Markdown 格式">
        {TOOLBAR_GROUPS.map((group, groupIndex) => (
          <div className="toolbar-group" key={groupIndex}>
            {group.map((item) => (
              <button
                className="toolbar-button"
                type="button"
                key={item.action}
                title={
                  item.shortcut
                    ? item.label + " · " + item.shortcut
                    : item.label
                }
                aria-label={item.label}
                disabled={readOnly}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runAction(item.action)}
              >
                <span aria-hidden="true">{item.glyph}</span>
              </button>
            ))}
          </div>
        ))}
        <span className="toolbar-note">
          原文保真 · 不支持的语法保持源码
        </span>
      </div>

      <div
        id="markdown-editor"
        ref={editorHostRef}
        className="codemirror-host"
        aria-label="Markdown 编辑器"
      />
    </article>
  );
}

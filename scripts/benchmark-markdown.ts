import { Compartment, EditorState } from "@codemirror/state";
import { createObsidianLivePreview } from "../app/lib/live-preview.ts";
import { parseObsidianMarkdown } from "../app/lib/obsidian-markdown.ts";

const TARGET_SIZES = [5_000, 20_000, 50_000, 100_000];
const FORMULA_COUNT = 50;
const PARAGRAPH_TEMPLATES = [
  (index: number) =>
    "第 " +
    index +
    " 段讨论 **结构化笔记**、[[概念/" +
    index +
    "|双向链接]] 与 #研究/主题" +
    (index % 7) +
    "。",
  (index: number) =>
    "Experiment " +
    index +
    " compares _live preview_ with source mode and keeps value_" +
    index +
    " unchanged.",
  (index: number) =>
    "> [!note] 样本 " +
    index +
    "\n> 这里包含脚注[^sample-" +
    index +
    "]、==高亮== 与行内公式 $x_" +
    index +
    "^2$。",
  (index: number) =>
    "- [" +
    (index % 3 === 0 ? "x" : " ") +
    "] 待办 " +
    index +
    "\n- 子项包含 URL https://example.com/item/" +
    index +
    "?mode=test",
];

function createStressDocument(targetSize: number): string {
  const parts = ["# 大文档压力测试", ""];
  for (let index = 0; index < FORMULA_COUNT; index += 1) {
    parts.push(
      "## 公式 " + (index + 1),
      "",
      "这是一段同时包含 **粗体**、[[Wiki Link]]、#标签 和 $E = mc^2$ 的正文。",
      "",
      "$$",
      "\\int_0^1 x^" + ((index % 5) + 1) + "\\,dx",
      "$$",
      "",
    );
  }

  let paragraph = 0;
  while (parts.join("\n").length < targetSize) {
    paragraph += 1;
    const paragraphBody =
      PARAGRAPH_TEMPLATES[paragraph % PARAGRAPH_TEMPLATES.length](paragraph);
    parts.push(
      "### 段落 " + paragraph,
      "",
      paragraphBody,
      "",
      "| 项目 | 状态 |",
      "| --- | --- |",
      "| Mini Canvas " + paragraph + " | 阶段 " + (paragraph % 5) + " |",
      "",
    );
  }

  return parts.join("\n");
}

function measure(run: () => void): number {
  const startedAt = performance.now();
  run();
  return performance.now() - startedAt;
}

const results: Array<Record<string, number>> = [];

for (const targetSize of TARGET_SIZES) {
  const source = createStressDocument(targetSize);
  let parseCalls = 0;
  const preview = createObsidianLivePreview((value) => {
    parseCalls += 1;
    return parseObsidianMarkdown(value);
  });
  const mode = new Compartment();

  let state!: EditorState;
  const createMs = measure(() => {
    state = EditorState.create({
      doc: source,
      extensions: [mode.of(preview)],
    });
  });

  const selectionMs = measure(() => {
    for (let index = 0; index < 100; index += 1) {
      const anchor = Math.floor((state.doc.length * index) / 100);
      state = state.update({ selection: { anchor } }).state;
    }
  });
  const parsesAfterSelection = parseCalls;

  const typingMs = measure(() => {
    for (let index = 0; index < 25; index += 1) {
      state = state.update({
        changes: { from: state.doc.length, insert: "字" },
      }).state;
    }
  });

  const pasteText = "粘贴内容 **bold** $x^2$ [[链接]]\n".repeat(150);
  const pasteMs = measure(() => {
    state = state.update({
      changes: { from: state.doc.length, insert: pasteText },
    }).state;
  });

  const modeSwitchMs = measure(() => {
    state = state.update({ effects: mode.reconfigure([]) }).state;
    state = state.update({ effects: mode.reconfigure(preview) }).state;
  });

  results.push({
    targetCharacters: targetSize,
    actualCharacters: source.length,
    createMs: Number(createMs.toFixed(2)),
    cursorMoves100Ms: Number(selectionMs.toFixed(2)),
    parsesAfterCursorMoves: parsesAfterSelection,
    typing25Ms: Number(typingMs.toFixed(2)),
    pasteMs: Number(pasteMs.toFixed(2)),
    modeSwitchMs: Number(modeSwitchMs.toFixed(2)),
    totalParseCalls: parseCalls,
  });
}

console.table(results);

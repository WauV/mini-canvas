import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import {
  createObsidianLivePreview,
  obsidianLivePreview,
} from "../app/lib/live-preview.ts";
import {
  type ObsidianTokenKind,
  parseObsidianMarkdown,
} from "../app/lib/obsidian-markdown.ts";

const SOURCE = [
  "---",
  "tags:",
  "  - test",
  "---",
  "",
  "# 标题",
  "",
  "> [!note] 提示",
  "> Callout 正文",
  "",
  "> 普通引用",
  "",
  "- [x] 完成任务",
  "- [[笔记|别名]]",
  "- ![[附件.png]]",
  "",
  "==高亮==、**粗体**、#标签 与 $E = mc^2$。",
  "",
  "引用脚注[^1]，以及^[行内脚注]。",
  "",
  "[^1]: 这是脚注定义。",
  "",
  "$$",
  "\\int_0^1 x^2\\,dx",
  "$$",
  "",
  "| 名称 | 状态 |",
  "| --- | --- |",
  "| Mini Canvas | 开发中 |",
  "",
  "块引用目标 ^demo",
  "",
  "%%隐藏注释%%",
].join("\n");

test("detects Obsidian-flavored Markdown without rewriting it", () => {
  const parsed = parseObsidianMarkdown(SOURCE);
  const kinds = new Set(parsed.tokens.map((token) => token.kind));

  const expectedKinds: ObsidianTokenKind[] = [
    "frontmatter",
    "heading",
    "callout",
    "blockquote",
    "footnote-definition",
    "footnote-reference",
    "inline-footnote",
    "task",
    "wiki-link",
    "embed",
    "highlight",
    "strong",
    "tag",
    "inline-math",
    "block-math",
    "table",
    "block-id",
    "comment",
  ];

  for (const expected of expectedKinds) {
    assert.ok(kinds.has(expected), "missing token: " + expected);
  }
});

test("does not treat a footnote definition as another reference", () => {
  const parsed = parseObsidianMarkdown("正文[^note]\n\n[^note]: 定义");
  const references = parsed.tokens.filter(
    (token) => token.kind === "footnote-reference",
  );
  const definitions = parsed.tokens.filter(
    (token) => token.kind === "footnote-definition",
  );

  assert.equal(references.length, 1);
  assert.equal(definitions.length, 1);
});

test("Live Preview decorations leave the CodeMirror document byte-for-byte intact", () => {
  const state = EditorState.create({
    doc: SOURCE,
    extensions: [obsidianLivePreview],
  });

  assert.equal(state.doc.toString(), SOURCE);

  const movedSelection = state.update({
    selection: { anchor: SOURCE.indexOf("[[笔记") + 3 },
  }).state;

  assert.equal(movedSelection.doc.toString(), SOURCE);
});

test("reuses parsed tokens when only the selection changes", () => {
  let parseCount = 0;
  const extension = createObsidianLivePreview((source) => {
    parseCount += 1;
    return parseObsidianMarkdown(source);
  });
  const initial = EditorState.create({
    doc: "# 标题\n\n正文",
    extensions: [extension],
  });

  const moved = initial.update({ selection: { anchor: 7 } }).state;
  assert.equal(parseCount, 1);

  const changed = moved.update({
    changes: { from: moved.doc.length, insert: "。" },
  }).state;
  assert.equal(changed.doc.toString(), "# 标题\n\n正文。");
  assert.equal(parseCount, 2);
});

test("does not parse formatting inside fenced code blocks", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const source = [fence + "md", "**不是粗体**", "[[也不是链接]]", fence].join(
    "\n",
  );
  const parsed = parseObsidianMarkdown(source);

  assert.deepEqual(
    parsed.tokens.map((token) => token.kind),
    ["code-block"],
  );
});

test("keeps an unclosed fenced block protected through end of document", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const parsed = parseObsidianMarkdown(
    [fence + "md", "**仍然是代码**", "[[仍然不是链接]]"].join("\n"),
  );

  assert.deepEqual(
    parsed.tokens.map((token) => token.kind),
    ["code-block"],
  );
});

test("keeps escaped pipes inside a table cell", () => {
  const parsed = parseObsidianMarkdown(
    [
      "| 表达式 | 含义 |",
      "| --- | --- |",
      "| `a \\| b` | 或运算 |",
    ].join("\n"),
  );
  const table = parsed.tokens.find((token) => token.kind === "table");

  assert.deepEqual(table?.data?.header, ["表达式", "含义"]);
  assert.deepEqual(table?.data?.rows, ["`a | b`\u001f或运算"]);
});

test("recognizes a same-line block formula", () => {
  const parsed = parseObsidianMarkdown("$$ E = mc^2 $$");
  const formula = parsed.tokens.find((token) => token.kind === "block-math");

  assert.equal(formula?.data?.latex, "E = mc^2");
});

test("recognizes both asterisk and underscore emphasis", () => {
  const source = "*星号斜体*、_下划线斜体_，但 foo_bar_baz 不是强调。";
  const parsed = parseObsidianMarkdown(source);
  const emphasis = parsed.tokens.filter((token) => token.kind === "emphasis");

  assert.deepEqual(
    emphasis.map((token) =>
      source.slice(token.contentFrom ?? token.from, token.contentTo ?? token.to),
    ),
    ["星号斜体", "下划线斜体"],
  );
});

test("keeps a callout title outside the replaced marker prefix", () => {
  const source =
    "> [!note] 这里的 **内联标题** 不会消失\n> 正常正文";
  const parsed = parseObsidianMarkdown(source);
  const callout = parsed.tokens.find((token) => token.kind === "callout");
  const titleFrom = source.indexOf("这里");

  assert.equal(callout?.markerRanges?.[0]?.to, titleFrom);
  assert.equal(callout?.data?.title, "这里的 **内联标题** 不会消失");
  assert.ok(
    parsed.tokens.some(
      (token) => token.kind === "strong" && token.from > titleFrom,
    ),
  );

  const state = EditorState.create({
    doc: source,
    extensions: [obsidianLivePreview],
  });
  assert.equal(state.doc.toString(), source);
});

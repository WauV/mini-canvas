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

test("treats Wiki Link syntax inside inline code as literal text", () => {
  const marker = String.fromCharCode(96);
  const source = `${marker}[[not-a-link]]${marker}`;
  const parsed = parseObsidianMarkdown(source);

  assert.deepEqual(
    parsed.tokens.map((token) => token.kind),
    ["inline-code"],
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

test("treats an even backslash run before a table pipe as a delimiter", () => {
  const parsed = parseObsidianMarkdown(
    [
      "| 第一列 | 第二列 |",
      "| --- | --- |",
      String.raw`| \\| 分隔后的单元格 |`,
    ].join("\n"),
  );
  const table = parsed.tokens.find((token) => token.kind === "table");

  assert.deepEqual(table?.data?.rows, ["\\\u001f分隔后的单元格"]);
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

test("recognizes fenced SVG as a preview block without rewriting source", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const svg = [
    '<svg viewBox="0 0 120 40">',
    '  <rect width="120" height="40" rx="8" fill="#d97757" />',
    "</svg>",
  ].join("\n");
  const source = [fence + "svg", svg, fence].join("\n");
  const parsed = parseObsidianMarkdown(source);
  const token = parsed.tokens.find((item) => item.kind === "svg-block");

  assert.equal(token?.data?.svg, svg);
  assert.equal(token?.data?.svgFormat, "fence");
  assert.deepEqual(parsed.tokens.map((item) => item.kind), ["svg-block"]);

  const state = EditorState.create({
    doc: source,
    extensions: [obsidianLivePreview],
  });
  assert.equal(state.doc.toString(), source);
});

test("recognizes an inline SVG block and protects its text from Markdown parsing", () => {
  const svg = [
    '<svg viewBox="0 0 120 40">',
    "  <text x=\"8\" y=\"25\">**不是粗体**</text>",
    "</svg>",
  ].join("\n");
  const source = svg + "\n\n**外部粗体**";
  const parsed = parseObsidianMarkdown(source);
  const svgToken = parsed.tokens.find((item) => item.kind === "svg-block");
  const strongTokens = parsed.tokens.filter((item) => item.kind === "strong");

  assert.equal(svgToken?.data?.svg, svg);
  assert.equal(svgToken?.data?.svgFormat, "inline");
  assert.equal(strongTokens.length, 1);
  assert.equal(
    source.slice(strongTokens[0].contentFrom, strongTokens[0].contentTo),
    "外部粗体",
  );
});

test("keeps token offsets correct for CRLF input", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const svg = '<svg viewBox="0 0 10 10"><circle r="4" /></svg>';
  const source = [
    fence + "svg",
    svg,
    fence,
    "> [!note] CRLF 标题",
    "> 正文",
  ].join("\r\n");
  const parsed = parseObsidianMarkdown(source);
  const svgToken = parsed.tokens.find((item) => item.kind === "svg-block");
  const callout = parsed.tokens.find((item) => item.kind === "callout");

  assert.equal(
    source.slice(svgToken?.contentFrom, svgToken?.contentTo),
    svg,
  );
  assert.equal(svgToken?.data?.svg, svg);
  assert.equal(callout?.data?.title, "CRLF 标题");
  assert.equal(
    source.slice(
      callout?.markerRanges?.[0]?.from,
      callout?.markerRanges?.[0]?.to,
    ),
    "> [!note] ",
  );
});

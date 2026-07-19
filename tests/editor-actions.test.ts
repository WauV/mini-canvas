import assert from "node:assert/strict";
import { test } from "vitest";
import {
  applyEditorAction,
  type EditorAction,
  insertText,
} from "../app/lib/editor-actions.ts";

test("wraps a selection with Markdown markers", () => {
  const result = applyEditorAction("hello world", 6, 11, "bold");

  assert.equal(result.value, "hello **world**");
  assert.equal(
    result.value.slice(result.selectionStart, result.selectionEnd),
    "world",
  );
});

test("removes Markdown markers when the selected text is already wrapped", () => {
  const result = applyEditorAction("hello **world**", 8, 13, "bold");

  assert.equal(result.value, "hello world");
  assert.equal(
    result.value.slice(result.selectionStart, result.selectionEnd),
    "world",
  );
});

test("prefixes every selected line", () => {
  const result = applyEditorAction("alpha\nbeta", 0, 10, "checklist");

  assert.equal(result.value, "- [ ] alpha\n- [ ] beta");
});

test("toggles selected checklist lines back to plain text", () => {
  const source = "- [ ] alpha\n- [x] beta";
  const result = applyEditorAction(source, 0, source.length, "checklist");

  assert.equal(result.value, "alpha\nbeta");
});

test("replaces another heading level and toggles level two off", () => {
  const replaced = applyEditorAction("# 标题", 0, 4, "heading");
  const removed = applyEditorAction(replaced.value, 0, replaced.value.length, "heading");

  assert.equal(replaced.value, "## 标题");
  assert.equal(removed.value, "标题");
});

test("inserts block math with an editable selection", () => {
  const result = applyEditorAction("", 0, 0, "block-math");

  assert.equal(result.value, "$$\n\\frac{a}{b}\n$$");
  assert.equal(
    result.value.slice(result.selectionStart, result.selectionEnd),
    "\\frac{a}{b}",
  );
});

test("toggles off a fenced code block when the caret is inside its body", () => {
  const source = "前文\n```ts\nconst answer = 42;\n```\n后文";
  const caret = source.indexOf("answer");
  const result = applyEditorAction(source, caret, caret, "code-block");

  assert.equal(result.value, "前文\nconst answer = 42;\n后文");
  assert.equal(
    result.value.slice(result.selectionStart, result.selectionEnd),
    "const answer = 42;",
  );
});

test("toggles off a fenced code block around a body selection and keeps CRLF", () => {
  const source = "前文\r\n~~~js\r\nline1\r\nline2\r\n~~~\r\n后文";
  const start = source.indexOf("line1");
  const end = source.indexOf("line2") + "line2".length;
  const result = applyEditorAction(source, start, end, "code-block");

  assert.equal(result.value, "前文\r\nline1\r\nline2\r\n后文");
});

test("uses the existing CRLF style when inserting a code block", () => {
  const source = "前文\r\n正文";
  const start = source.indexOf("正文");
  const result = applyEditorAction(source, start, source.length, "code-block");

  assert.equal(result.value, "前文\r\n```\r\n正文\r\n```");
});

test("wraps a later selection without disturbing an earlier fenced block", () => {
  const source = "```\nold\n```\nplain";
  const start = source.indexOf("plain");
  const result = applyEditorAction(source, start, source.length, "code-block");

  assert.equal(result.value, "```\nold\n```\n```\nplain\n```");
});

test("inserts a numbered footnote without reformatting the document", () => {
  const result = applyEditorAction("正文", 2, 2, "footnote");

  assert.equal(result.value, "正文[^1]\n\n[^1]: 脚注内容");
  assert.equal(
    result.value.slice(result.selectionStart, result.selectionEnd),
    "脚注内容",
  );
});

test("preserves CRLF line endings when appending a footnote", () => {
  const source = "第一行\r\n第二行";
  const result = applyEditorAction(
    source,
    source.length,
    source.length,
    "footnote",
  );

  assert.equal(
    result.value,
    "第一行\r\n第二行[^1]\r\n\r\n[^1]: 脚注内容",
  );
});

test("uses the next available numeric footnote id", () => {
  const source = "已有[^1]\n\n[^1]: 第一条";
  const result = applyEditorAction(source, 2, 2, "footnote");

  assert.ok(result.value.includes("已有[^2][^1]"));
  assert.ok(result.value.endsWith("[^2]: 脚注内容"));
});

test("inserts text at the caret", () => {
  const result = insertText("ab", 1, 1, "  ");

  assert.equal(result.value, "a  b");
  assert.equal(result.selectionStart, 3);
  assert.equal(result.selectionEnd, 3);
});

const PLACEHOLDER_ACTIONS: Array<{
  action: EditorAction;
  expected: string;
}> = [
  { action: "heading", expected: "## " },
  { action: "bold", expected: "**粗体文本**" },
  { action: "italic", expected: "_斜体文本_" },
  { action: "quote", expected: "> " },
  { action: "bullet", expected: "- " },
  { action: "checklist", expected: "- [ ] " },
  { action: "highlight", expected: "==高亮文本==" },
  { action: "wikilink", expected: "[[笔记名称]]" },
  { action: "callout", expected: "> [!note] 提示\n> 在这里输入提示内容" },
  { action: "footnote", expected: "[^1]\n\n[^1]: 脚注内容" },
  { action: "inline-code", expected: "`code`" },
  { action: "code-block", expected: "```\n在这里输入代码\n```" },
  { action: "link", expected: "[链接文字](https://example.com)" },
  { action: "inline-math", expected: "$E = mc^2$" },
  { action: "block-math", expected: "$$\n\\frac{a}{b}\n$$" },
];

test.each(PLACEHOLDER_ACTIONS)(
  "inserts the $action placeholder at an empty caret",
  ({ action, expected }) => {
    const result = applyEditorAction("", 0, 0, action);
    assert.equal(result.value, expected);
    assert.ok(result.selectionEnd >= result.selectionStart);
  },
);

test("unwraps markers when the selected range includes both markers", () => {
  const source = "**完整选择**";
  const result = applyEditorAction(source, 0, source.length, "bold");

  assert.equal(result.value, "完整选择");
  assert.equal(result.selectionStart, 0);
  assert.equal(result.selectionEnd, 4);
});

test("toggles quotes off for every selected line", () => {
  const source = "> 第一行\n> 第二行";
  const result = applyEditorAction(source, 0, source.length, "quote");

  assert.equal(result.value, "第一行\n第二行");
});

test("converts mixed list markers while preserving indentation", () => {
  const source = "  1. 第一项\n  - [x] 第二项";
  const result = applyEditorAction(source, 0, source.length, "bullet");

  assert.equal(result.value, "  - 第一项\n  - 第二项");
});

test("a selection ending in a newline does not alter the following line", () => {
  const source = "第一行\n第二行\n第三行";
  const selectedEnd = "第一行\n第二行\n".length;
  const result = applyEditorAction(source, 0, selectedEnd, "quote");

  assert.equal(result.value, "> 第一行\n> 第二行\n第三行");
});

test("creates a multiline callout around complete selected lines", () => {
  const source = "前文\n第一行\n第二行\n后文";
  const start = source.indexOf("第一行");
  const end = source.indexOf("第二行") + "第二行".length;
  const result = applyEditorAction(source, start, end, "callout");

  assert.equal(
    result.value,
    "前文\n> [!note] 提示\n> 第一行\n> 第二行\n后文",
  );
});

test("appends a footnote without adding a third blank line", () => {
  const source = "正文\n\n";
  const result = applyEditorAction(source, 2, 2, "footnote");

  assert.equal(result.value, "正文[^1]\n\n[^1]: 脚注内容");
});

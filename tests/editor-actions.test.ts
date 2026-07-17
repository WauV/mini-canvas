import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEditorAction,
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

test("inserts a numbered footnote without reformatting the document", () => {
  const result = applyEditorAction("正文", 2, 2, "footnote");

  assert.equal(result.value, "正文[^1]\n\n[^1]: 脚注内容");
  assert.equal(
    result.value.slice(result.selectionStart, result.selectionEnd),
    "脚注内容",
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

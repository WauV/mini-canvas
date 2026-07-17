import assert from "node:assert/strict";
import test from "node:test";
import { calculateDocumentStatistics } from "../app/lib/document-statistics.ts";

test("counts CJK characters and Latin words in mixed writing", () => {
  const statistics = calculateDocumentStatistics(
    "今天学习 Fourier transform\nHello, Mini-Canvas 2",
  );

  assert.equal(statistics.lines, 2);
  assert.equal(statistics.words, 4 + 4);
  assert.equal(statistics.characters, 43);
});

test("does not count a trailing newline as an extra line", () => {
  assert.equal(calculateDocumentStatistics("abc\n").lines, 1);
  assert.equal(calculateDocumentStatistics("abc\n\n").lines, 2);
  assert.equal(calculateDocumentStatistics("第一行\r\n第二行\r\n").lines, 2);
});

test("does not count standalone numbers as words", () => {
  assert.equal(calculateDocumentStatistics("42 is 答案").words, 3);
  assert.equal(calculateDocumentStatistics("42").words, 0);
  assert.equal(calculateDocumentStatistics("HTML5 与 42nd").words, 3);
});

test("returns zero lines for an empty document", () => {
  assert.deepEqual(calculateDocumentStatistics(""), {
    lines: 0,
    words: 0,
    characters: 0,
  });
});

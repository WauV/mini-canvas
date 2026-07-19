import assert from "node:assert/strict";
import { test } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  createObsidianLivePreview,
  obsidianLivePreview,
} from "../app/lib/live-preview.ts";
import {
  type ObsidianToken,
  type ObsidianTokenKind,
  parseObsidianMarkdown,
} from "../app/lib/obsidian-markdown.ts";

function assertTokenRanges(source: string, tokens: ObsidianToken[]): void {
  for (const token of tokens) {
    assert.ok(token.from >= 0, `${token.kind} starts before the document`);
    assert.ok(token.to >= token.from, `${token.kind} has a reversed range`);
    assert.ok(token.to <= source.length, `${token.kind} ends after the document`);

    if (token.contentFrom !== undefined || token.contentTo !== undefined) {
      assert.equal(
        token.contentFrom !== undefined && token.contentTo !== undefined,
        true,
        `${token.kind} must provide both content offsets`,
      );
      assert.ok(token.contentFrom! >= token.from);
      assert.ok(token.contentTo! >= token.contentFrom!);
      assert.ok(token.contentTo! <= token.to);
    }

    for (const marker of token.markerRanges ?? []) {
      assert.ok(marker.from >= token.from, `${token.kind} marker starts too early`);
      assert.ok(marker.to >= marker.from, `${token.kind} marker is reversed`);
      assert.ok(marker.to <= token.to, `${token.kind} marker ends too late`);
    }
  }
}

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

test("keeps parsed Wiki and Embed file targets separate from aliases and subpaths", () => {
  const parsed = parseObsidianMarkdown(
    "[[Notes/Page#章节|别名]] ![[Assets/示意图.png|320x180]]",
  );
  const wiki = parsed.tokens.find((token) => token.kind === "wiki-link");
  const embed = parsed.tokens.find((token) => token.kind === "embed");

  assert.deepEqual(wiki?.data, {
    target: "Notes/Page#章节",
    path: "Notes/Page",
    subpath: "#章节",
    label: "别名",
  });
  assert.deepEqual(embed?.data, {
    target: "Assets/示意图.png",
    path: "Assets/示意图.png",
    subpath: "",
    label: "示意图.png",
    width: 320,
    height: 180,
  });
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

const TOKEN_CASES: Array<{
  kind: ObsidianTokenKind;
  source: string;
}> = [
  { kind: "frontmatter", source: "---\ntags: [test]\n---\n正文" },
  { kind: "code-block", source: "```ts\nconst answer = 42;\n```" },
  {
    kind: "svg-block",
    source: '<svg viewBox="0 0 10 10"><circle r="4" /></svg>',
  },
  { kind: "block-math", source: "$$\nx^2 + y^2\n$$" },
  { kind: "table", source: "| A | B |\n| --- | --- |\n| 1 | 2 |" },
  { kind: "callout", source: "> [!warning] 注意\n> 正文" },
  { kind: "footnote-definition", source: "[^ref]: 脚注正文" },
  { kind: "heading", source: "### 三级标题" },
  { kind: "task", source: "- [ ] 待办" },
  { kind: "bullet", source: "+ 普通列表" },
  { kind: "ordered-list", source: "12. 有序列表" },
  { kind: "blockquote", source: "> 普通引用" },
  { kind: "horizontal-rule", source: "- - -" },
  { kind: "comment", source: "正文 %%隐藏 **格式**%% 结尾" },
  { kind: "wiki-link", source: "[[目标笔记|显示名]]" },
  { kind: "embed", source: "![[附件.png]]" },
  { kind: "markdown-link", source: "[OpenAI](https://openai.com)" },
  { kind: "markdown-image", source: "![图](images/demo.png)" },
  { kind: "footnote-reference", source: "正文[^ref]" },
  { kind: "inline-footnote", source: "正文^[行内说明]" },
  { kind: "inline-code", source: "正文 `const x = 1`" },
  { kind: "inline-math", source: "正文 $E = mc^2$" },
  { kind: "strong", source: "**粗体**" },
  { kind: "emphasis", source: "_斜体_" },
  { kind: "strikethrough", source: "~~删除~~" },
  { kind: "highlight", source: "==高亮==" },
  { kind: "tag", source: "正文 #项目/测试" },
  { kind: "block-id", source: "可引用段落 ^block-1" },
];

test.each(TOKEN_CASES)("recognizes the $kind token family", ({ kind, source }) => {
  const parsed = parseObsidianMarkdown(source);
  assert.ok(
    parsed.tokens.some((token) => token.kind === kind),
    `missing ${kind}: ${source}`,
  );
  assertTokenRanges(source, parsed.tokens);
});

test("protects literal and hidden ranges from nested Markdown parsing", () => {
  const source = [
    "`**code** [[link]] #tag $math$`",
    "%%**comment** [[link]] #tag $math$%%",
    "\\[[escaped-link]]",
  ].join("\n");
  const parsed = parseObsidianMarkdown(source);

  assert.deepEqual(
    parsed.tokens.map((token) => token.kind),
    ["inline-code", "comment"],
  );
  assertTokenRanges(source, parsed.tokens);
});

test("leaves unclosed inline markers as editable source", () => {
  const source = "**粗体未闭合\n[[链接未闭合\n$公式未闭合\n%%注释未闭合";
  const parsed = parseObsidianMarkdown(source);

  assert.equal(parsed.tokens.length, 0);
  assertTokenRanges(source, parsed.tokens);
});

test("keeps source byte-for-byte intact across the supported syntax corpus", () => {
  for (const { kind, source } of TOKEN_CASES) {
    const state = EditorState.create({
      doc: source,
      extensions: [obsidianLivePreview],
    });
    assert.equal(state.doc.toString(), source, `${kind} changed source text`);
  }
});

test("parser never emits invalid ranges for deterministic noisy input", () => {
  let seed = 0x5eed1234;
  const alphabet = [
    "#",
    "*",
    "_",
    "[",
    "]",
    "(",
    ")",
    "`",
    "$",
    "%",
    "|",
    "^",
    "\\",
    "\n",
    "\r\n",
    "中",
    "a",
    "1",
    " ",
  ];

  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  for (let sample = 0; sample < 300; sample += 1) {
    const length = 1 + Math.floor(random() * 180);
    let source = "";
    for (let index = 0; index < length; index += 1) {
      source += alphabet[Math.floor(random() * alphabet.length)];
    }
    const parsed = parseObsidianMarkdown(source);
    assertTokenRanges(source, parsed.tokens);
    for (const line of parsed.lines) {
      assert.equal(source.slice(line.from, line.to), line.text);
    }
  }
});

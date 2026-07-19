import { parseObsidianLink } from "./obsidian-links.ts";

export type TextRange = {
  from: number;
  to: number;
};

export type ObsidianTokenKind =
  | "frontmatter"
  | "code-block"
  | "svg-block"
  | "block-math"
  | "table"
  | "callout"
  | "footnote-definition"
  | "heading"
  | "task"
  | "bullet"
  | "ordered-list"
  | "blockquote"
  | "horizontal-rule"
  | "comment"
  | "wiki-link"
  | "embed"
  | "markdown-link"
  | "markdown-image"
  | "footnote-reference"
  | "inline-footnote"
  | "inline-code"
  | "inline-math"
  | "strong"
  | "emphasis"
  | "strikethrough"
  | "highlight"
  | "tag"
  | "block-id";

export type ObsidianToken = {
  kind: ObsidianTokenKind;
  from: number;
  to: number;
  contentFrom?: number;
  contentTo?: number;
  markerRanges?: TextRange[];
  data?: {
    [key: string]: string | boolean | number | string[] | TextRange[];
  };
};

export type MarkdownLine = {
  from: number;
  to: number;
  text: string;
};

export type ParsedObsidianMarkdown = {
  lines: MarkdownLine[];
  tokens: ObsidianToken[];
};

function getLines(source: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let lineStart = 0;

  for (let cursor = 0; cursor <= source.length; cursor += 1) {
    const character = source[cursor];
    const atEnd = cursor === source.length;
    if (!atEnd && character !== "\n" && character !== "\r") continue;

    lines.push({
      from: lineStart,
      to: cursor,
      text: source.slice(lineStart, cursor),
    });

    if (character === "\r" && source[cursor + 1] === "\n") cursor += 1;
    lineStart = cursor + 1;
  }

  return lines;
}

function rangesOverlap(
  from: number,
  to: number,
  ranges: TextRange[],
): boolean {
  return ranges.some((range) => from < range.to && to > range.from);
}

function addOccupiedRange(
  occupied: TextRange[],
  from: number,
  to: number,
): void {
  occupied.push({ from, to });
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function hasUnescapedPipe(line: string): boolean {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|" && !isEscapedAt(line, index)) return true;
  }
  return false;
}

function isTableDivider(line: string): boolean {
  const cells = splitTableRow(line);
  return (
    cells.length > 1 &&
    cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
  );
}

function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (
    source.endsWith("|") &&
    !isEscapedAt(source, source.length - 1)
  ) {
    source = source.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      let runEnd = index;
      while (source[runEnd] === "\\") runEnd += 1;
      const backslashCount = runEnd - index;

      if (source[runEnd] === "|") {
        cell += "\\".repeat(Math.floor(backslashCount / 2));
        if (backslashCount % 2 === 1) {
          cell += "|";
        } else {
          cells.push(cell.trim());
          cell = "";
        }
        index = runEnd;
        continue;
      }

      cell += "\\".repeat(backslashCount);
      index = runEnd - 1;
      continue;
    }
    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function parseBlockTokens(
  lines: MarkdownLine[],
  tokens: ObsidianToken[],
  protectedRanges: TextRange[],
): void {
  if (lines[0]?.text.trim() === "---") {
    const closingIndex = lines.findIndex(
      (line, index) => index > 0 && line.text.trim() === "---",
    );

    if (closingIndex > 0) {
      const closing = lines[closingIndex];
      const range = { from: 0, to: closing.to };
      tokens.push({
        kind: "frontmatter",
        ...range,
        markerRanges: [
          { from: lines[0].from, to: lines[0].to },
          { from: closing.from, to: closing.to },
        ],
      });
      protectedRanges.push(range);
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (rangesOverlap(line.from, line.to, protectedRanges)) continue;

    const fenceMatch = line.text.match(/^ {0,3}((?:\x60){3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const fenceCharacter = fence[0];
      let closingIndex = index + 1;

      while (closingIndex < lines.length) {
        const closingText = lines[closingIndex].text.trim();
        if (
          closingText.length >= fence.length &&
          Array.from(closingText).every(
            (character) => character === fenceCharacter,
          )
        ) {
          break;
        }
        closingIndex += 1;
      }

      const hasClosingFence = closingIndex < lines.length;
      const closing = hasClosingFence
        ? lines[closingIndex]
        : lines[lines.length - 1];
      const range = { from: line.from, to: closing.to };
      const language = fenceMatch[2].trim().split(/\s+/u, 1)[0].toLowerCase();
      const isSvg = hasClosingFence && language === "svg";
      const contentFrom = lines[index + 1]?.from ?? line.to;
      const contentTo = hasClosingFence
        ? closingIndex > index + 1
          ? lines[closingIndex - 1].to
          : contentFrom
        : closing.to;
      tokens.push({
        kind: isSvg ? "svg-block" : "code-block",
        ...range,
        contentFrom,
        contentTo,
        markerRanges: hasClosingFence
          ? [
              { from: line.from, to: line.to },
              { from: closing.from, to: closing.to },
            ]
          : [{ from: line.from, to: line.to }],
        data: {
          language,
          ...(isSvg
            ? {
                svg: lines
                  .slice(index + 1, closingIndex)
                  .map((item) => item.text)
                  .join("\n"),
                svgFormat: "fence",
              }
            : {}),
        },
      });
      protectedRanges.push(range);
      index = hasClosingFence ? closingIndex : lines.length - 1;
      continue;
    }

    const svgOpening = line.text.match(/^\s*<svg(?:\s|>)/iu);
    if (svgOpening) {
      const openingOffset = line.text.search(/<svg(?:\s|>)/iu);
      let closingIndex = index;
      let closingMatch = lines[closingIndex].text.match(/<\/svg\s*>/iu);

      while (!closingMatch && closingIndex + 1 < lines.length) {
        closingIndex += 1;
        closingMatch = lines[closingIndex].text.match(/<\/svg\s*>/iu);
      }

      if (closingMatch) {
        const closingLine = lines[closingIndex];
        const closingEnd = (closingMatch.index ?? 0) + closingMatch[0].length;
        const trailingSource = closingLine.text.slice(closingEnd);

        if (trailingSource.trim().length === 0) {
          const svg = lines
            .slice(index, closingIndex + 1)
            .map((item, lineIndex, blockLines) => {
              if (lineIndex === 0 && lineIndex === blockLines.length - 1) {
                return item.text.slice(openingOffset, closingEnd);
              }
              if (lineIndex === 0) return item.text.slice(openingOffset);
              if (lineIndex === blockLines.length - 1) {
                return item.text.slice(0, closingEnd);
              }
              return item.text;
            })
            .join("\n");
          const range = { from: line.from, to: closingLine.to };
          tokens.push({
            kind: "svg-block",
            ...range,
            data: { svg, svgFormat: "inline" },
          });
          protectedRanges.push(range);
          index = closingIndex;
          continue;
        }
      }
    }

    const sameLineMath = line.text.match(/^\s*\$\$(.+?)\$\$\s*$/);
    if (sameLineMath) {
      const range = { from: line.from, to: line.to };
      tokens.push({
        kind: "block-math",
        ...range,
        data: { latex: sameLineMath[1].trim() },
      });
      protectedRanges.push(range);
      continue;
    }

    if (line.text.trim() === "$$") {
      let closingIndex = index + 1;
      while (
        closingIndex < lines.length &&
        lines[closingIndex].text.trim() !== "$$"
      ) {
        closingIndex += 1;
      }

      if (closingIndex < lines.length) {
        const closing = lines[closingIndex];
        const range = { from: line.from, to: closing.to };
        const latex = lines
          .slice(index + 1, closingIndex)
          .map((item) => item.text)
          .join("\n");
        tokens.push({
          kind: "block-math",
          ...range,
          contentFrom: lines[index + 1].from,
          contentTo:
            closingIndex > index + 1
              ? lines[closingIndex - 1].to
              : lines[index + 1].from,
          data: { latex },
        });
        protectedRanges.push(range);
        index = closingIndex;
        continue;
      }
    }

    const nextLine = lines[index + 1];
    if (
      hasUnescapedPipe(line.text) &&
      nextLine &&
      isTableDivider(nextLine.text)
    ) {
      let closingIndex = index + 2;
      while (
        closingIndex < lines.length &&
        hasUnescapedPipe(lines[closingIndex].text) &&
        lines[closingIndex].text.trim() !== ""
      ) {
        closingIndex += 1;
      }

      const lastLine = lines[closingIndex - 1];
      const range = { from: line.from, to: lastLine.to };
      const rows = [
        splitTableRow(line.text),
        ...lines
          .slice(index + 2, closingIndex)
          .map((item) => splitTableRow(item.text)),
      ];
      tokens.push({
        kind: "table",
        ...range,
        data: {
          header: splitTableRow(line.text),
          rows: rows.slice(1).map((row) => row.join("\u001f")),
        },
      });
      protectedRanges.push(range);
      index = closingIndex - 1;
    }
  }
}

function parseLineTokens(
  lines: MarkdownLine[],
  tokens: ObsidianToken[],
  protectedRanges: TextRange[],
): void {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (rangesOverlap(line.from, line.to, protectedRanges)) continue;

    const calloutMatch = line.text.match(
      /^(\s*>\s*)\[!([A-Za-z0-9_-]+)\]([+-])?(\s*)(.*)$/,
    );
    if (calloutMatch) {
      let closingIndex = index + 1;
      // The separator whitespace belongs to the visual marker replacement so
      // the title starts flush after the widget's own margin.
      const openingMarkerTo =
        line.from +
        calloutMatch[1].length +
        calloutMatch[2].length +
        (calloutMatch[3]?.length ?? 0) +
        calloutMatch[4].length +
        3;
      const markerRanges: TextRange[] = [
        {
          from: line.from,
          to: openingMarkerTo,
        },
      ];

      while (
        closingIndex < lines.length &&
        /^\s*>/.test(lines[closingIndex].text)
      ) {
        const prefix = lines[closingIndex].text.match(/^(\s*>\s?)/)?.[1] ?? "";
        markerRanges.push({
          from: lines[closingIndex].from,
          to: lines[closingIndex].from + prefix.length,
        });
        closingIndex += 1;
      }

      tokens.push({
        kind: "callout",
        from: line.from,
        to: lines[closingIndex - 1].to,
        markerRanges,
        data: {
          calloutType: calloutMatch[2].toLowerCase(),
          folded: calloutMatch[3] ?? "",
          title: calloutMatch[5].trim(),
        },
      });
      index = closingIndex - 1;
      continue;
    }

    const footnoteDefinitionMatch = line.text.match(
      /^(\s*)\[\^([^\]\s]+)\]:(\s*)(.*)$/,
    );
    if (footnoteDefinitionMatch) {
      const markerTo =
        line.from +
        footnoteDefinitionMatch[1].length +
        footnoteDefinitionMatch[2].length +
        footnoteDefinitionMatch[3].length +
        4;
      tokens.push({
        kind: "footnote-definition",
        from: line.from,
        to: line.to,
        contentFrom: markerTo,
        contentTo: line.to,
        markerRanges: [{ from: line.from, to: markerTo }],
        data: { id: footnoteDefinitionMatch[2] },
      });
      continue;
    }

    const headingMatch = line.text.match(/^(\s{0,3})(#{1,6})(\s+)/);
    if (headingMatch) {
      const markerTo =
        line.from +
        headingMatch[1].length +
        headingMatch[2].length +
        headingMatch[3].length;
      tokens.push({
        kind: "heading",
        from: line.from,
        to: line.to,
        contentFrom: markerTo,
        contentTo: line.to,
        markerRanges: [{ from: line.from, to: markerTo }],
        data: { level: headingMatch[2].length },
      });
      continue;
    }

    const taskMatch = line.text.match(/^(\s*[-*+]\s+)\[([ xX])\](\s+)/);
    if (taskMatch) {
      const markerTo =
        line.from +
        taskMatch[1].length +
        taskMatch[2].length +
        taskMatch[3].length +
        2;
      const checkFrom = line.from + taskMatch[1].length + 1;
      tokens.push({
        kind: "task",
        from: line.from,
        to: line.to,
        contentFrom: markerTo,
        contentTo: line.to,
        markerRanges: [{ from: line.from, to: markerTo }],
        data: {
          checked: taskMatch[2].toLowerCase() === "x",
          checkFrom,
        },
      });
      continue;
    }

    const quoteMatch = line.text.match(/^(\s*>\s?)/);
    if (quoteMatch) {
      tokens.push({
        kind: "blockquote",
        from: line.from,
        to: line.to,
        contentFrom: line.from + quoteMatch[1].length,
        contentTo: line.to,
        markerRanges: [
          { from: line.from, to: line.from + quoteMatch[1].length },
        ],
      });
      continue;
    }

    // A spaced thematic break such as "- - -" also begins with a list
    // marker, so it must be recognized before the generic bullet branch.
    if (
      /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/.test(
        line.text,
      )
    ) {
      tokens.push({
        kind: "horizontal-rule",
        from: line.from,
        to: line.to,
      });
      continue;
    }

    const bulletMatch = line.text.match(/^(\s*)([-*+])(\s+)/);
    if (bulletMatch) {
      const markerTo =
        line.from +
        bulletMatch[1].length +
        bulletMatch[2].length +
        bulletMatch[3].length;
      tokens.push({
        kind: "bullet",
        from: line.from,
        to: line.to,
        contentFrom: markerTo,
        contentTo: line.to,
        markerRanges: [{ from: line.from, to: markerTo }],
      });
      continue;
    }

    const orderedMatch = line.text.match(/^(\s*)(\d+\.)(\s+)/);
    if (orderedMatch) {
      const markerTo =
        line.from +
        orderedMatch[1].length +
        orderedMatch[2].length +
        orderedMatch[3].length;
      tokens.push({
        kind: "ordered-list",
        from: line.from,
        to: line.to,
        contentFrom: markerTo,
        contentTo: line.to,
        markerRanges: [{ from: line.from, to: markerTo }],
        data: { order: orderedMatch[2].slice(0, -1) },
      });
      continue;
    }

  }
}

type InlinePattern = {
  kind: ObsidianTokenKind;
  expression: RegExp;
  getToken: (
    match: RegExpExecArray,
    absoluteFrom: number,
  ) => ObsidianToken;
};

function parseInlineTokens(
  source: string,
  lines: MarkdownLine[],
  tokens: ObsidianToken[],
  protectedRanges: TextRange[],
): void {
  const occupied: TextRange[] = [...protectedRanges];

  const commentExpression = /%%[\s\S]*?%%/g;
  for (const match of source.matchAll(commentExpression)) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesOverlap(from, to, occupied)) continue;
    tokens.push({
      kind: "comment",
      from,
      to,
      contentFrom: from + 2,
      contentTo: to - 2,
    });
    addOccupiedRange(occupied, from, to);
  }

  const patterns: InlinePattern[] = [
    // Inline code must claim its range before links or other Markdown syntax.
    // Obsidian treats everything between the matching backticks as literal.
    {
      kind: "inline-code",
      expression: /(\x60+)([^\x60\n]+?)\1/g,
      getToken: (match, from) => ({
        kind: "inline-code",
        from,
        to: from + match[0].length,
        contentFrom: from + match[1].length,
        contentTo: from + match[0].length - match[1].length,
        markerRanges: [
          { from, to: from + match[1].length },
          {
            from: from + match[0].length - match[1].length,
            to: from + match[0].length,
          },
        ],
      }),
    },
    {
      kind: "wiki-link",
      expression: /(!?)\[\[([^\]\n]+)\]\]/g,
      getToken: (match, from) => {
        const link = parseObsidianLink(match[2], { embed: Boolean(match[1]) });
        return {
          kind: match[1] ? "embed" : "wiki-link",
          from,
          to: from + match[0].length,
          contentFrom: from + match[1].length + 2,
          contentTo: from + match[0].length - 2,
          data: {
            target: link.target,
            path: link.path,
            subpath: link.subpath,
            label: link.label,
            ...(link.width ? { width: link.width } : {}),
            ...(link.height ? { height: link.height } : {}),
          },
        };
      },
    },
    {
      kind: "markdown-link",
      expression: /(!?)\[([^\]\n]+)\]\(([^)\n]+)\)/g,
      getToken: (match, from) => {
        const labelFrom = from + match[1].length + 1;
        return {
          kind: match[1] ? "markdown-image" : "markdown-link",
          from,
          to: from + match[0].length,
          contentFrom: labelFrom,
          contentTo: labelFrom + match[2].length,
          markerRanges: [
            { from, to: labelFrom },
            {
              from: labelFrom + match[2].length,
              to: from + match[0].length,
            },
          ],
          data: { label: match[2], target: match[3] },
        };
      },
    },
    {
      kind: "inline-footnote",
      expression: /\^\[([^\]\n]+)\]/g,
      getToken: (match, from) => ({
        kind: "inline-footnote",
        from,
        to: from + match[0].length,
        contentFrom: from + 2,
        contentTo: from + match[0].length - 1,
        data: { content: match[1] },
      }),
    },
    {
      kind: "footnote-reference",
      expression: /\[\^([^\]\s]+)\](?!:)/g,
      getToken: (match, from) => ({
        kind: "footnote-reference",
        from,
        to: from + match[0].length,
        data: { id: match[1] },
      }),
    },
    {
      kind: "inline-math",
      expression: /\$(?!\$)([^$\n]+?)\$(?!\$)/g,
      getToken: (match, from) => ({
        kind: "inline-math",
        from,
        to: from + match[0].length,
        contentFrom: from + 1,
        contentTo: from + match[0].length - 1,
        data: { latex: match[1] },
      }),
    },
    {
      kind: "strong",
      expression: /(\*\*|__)(?=\S)(.+?\S)\1/g,
      getToken: (match, from) => ({
        kind: "strong",
        from,
        to: from + match[0].length,
        contentFrom: from + match[1].length,
        contentTo: from + match[0].length - match[1].length,
        markerRanges: [
          { from, to: from + match[1].length },
          {
            from: from + match[0].length - match[1].length,
            to: from + match[0].length,
          },
        ],
      }),
    },
    {
      kind: "strikethrough",
      expression: /~~(?=\S)(.+?\S)~~/g,
      getToken: (match, from) => ({
        kind: "strikethrough",
        from,
        to: from + match[0].length,
        contentFrom: from + 2,
        contentTo: from + match[0].length - 2,
        markerRanges: [
          { from, to: from + 2 },
          { from: from + match[0].length - 2, to: from + match[0].length },
        ],
      }),
    },
    {
      kind: "highlight",
      expression: /==(?=\S)(.+?\S)==/g,
      getToken: (match, from) => ({
        kind: "highlight",
        from,
        to: from + match[0].length,
        contentFrom: from + 2,
        contentTo: from + match[0].length - 2,
        markerRanges: [
          { from, to: from + 2 },
          { from: from + match[0].length - 2, to: from + match[0].length },
        ],
      }),
    },
    {
      kind: "emphasis",
      expression: /(?<!\*)\*(?!\*)(?=\S)([^*\n]+?\S)\*(?!\*)/g,
      getToken: (match, from) => ({
        kind: "emphasis",
        from,
        to: from + match[0].length,
        contentFrom: from + 1,
        contentTo: from + match[0].length - 1,
        markerRanges: [
          { from, to: from + 1 },
          { from: from + match[0].length - 1, to: from + match[0].length },
        ],
      }),
    },
    {
      kind: "emphasis",
      expression:
        /(?<![\p{L}\p{N}_])_(?!_)(?=\S)([^_\n]+?\S)_(?![\p{L}\p{N}_])/gu,
      getToken: (match, from) => ({
        kind: "emphasis",
        from,
        to: from + match[0].length,
        contentFrom: from + 1,
        contentTo: from + match[0].length - 1,
        markerRanges: [
          { from, to: from + 1 },
          { from: from + match[0].length - 1, to: from + match[0].length },
        ],
      }),
    },
  ];

  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.expression.exec(source)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      if (
        source[from - 1] === "\\" ||
        rangesOverlap(from, to, occupied)
      ) {
        continue;
      }
      tokens.push(pattern.getToken(match, from));
      addOccupiedRange(occupied, from, to);
    }
  }

  for (const line of lines) {
    if (rangesOverlap(line.from, line.to, protectedRanges)) continue;

    const tagExpression = /(^|[^\p{L}\p{N}_/-])#([\p{L}\p{N}_/-]+)/gu;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagExpression.exec(line.text)) !== null) {
      const prefixLength = tagMatch[1].length;
      const from = line.from + tagMatch.index + prefixLength;
      const to = from + tagMatch[0].length - prefixLength;
      if (rangesOverlap(from, to, occupied)) continue;
      tokens.push({
        kind: "tag",
        from,
        to,
        data: { tag: tagMatch[2] },
      });
      addOccupiedRange(occupied, from, to);
    }

    const blockIdMatch = line.text.match(/\s\^([A-Za-z0-9-]+)\s*$/);
    if (blockIdMatch && blockIdMatch.index !== undefined) {
      const caretOffset = blockIdMatch[0].indexOf("^");
      const from = line.from + blockIdMatch.index + caretOffset;
      const to = from + blockIdMatch[1].length + 1;
      if (!rangesOverlap(from, to, occupied)) {
        tokens.push({
          kind: "block-id",
          from,
          to,
          data: { id: blockIdMatch[1] },
        });
      }
    }
  }
}

export function parseObsidianMarkdown(
  source: string,
): ParsedObsidianMarkdown {
  const lines = getLines(source);
  const tokens: ObsidianToken[] = [];
  const protectedRanges: TextRange[] = [];

  parseBlockTokens(lines, tokens, protectedRanges);
  parseLineTokens(lines, tokens, protectedRanges);
  parseInlineTokens(source, lines, tokens, protectedRanges);

  tokens.sort((left, right) => left.from - right.from || left.to - right.to);
  return { lines, tokens };
}

export type EditorAction =
  | "heading"
  | "bold"
  | "italic"
  | "quote"
  | "bullet"
  | "checklist"
  | "highlight"
  | "wikilink"
  | "callout"
  | "footnote"
  | "inline-code"
  | "code-block"
  | "link"
  | "inline-math"
  | "block-math";

export type TextEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

const INLINE_CODE = String.fromCharCode(96);
const CODE_FENCE = INLINE_CODE.repeat(3);

function toggleWrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): TextEdit {
  const selected = value.slice(start, end);

  if (
    start >= before.length &&
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after
  ) {
    const nextStart = start - before.length;
    return {
      value:
        value.slice(0, nextStart) +
        selected +
        value.slice(end + after.length),
      selectionStart: nextStart,
      selectionEnd: nextStart + selected.length,
    };
  }

  if (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    const content = selected.slice(before.length, -after.length);
    return {
      value: value.slice(0, start) + content + value.slice(end),
      selectionStart: start,
      selectionEnd: start + content.length,
    };
  }

  const content = selected || placeholder;
  const nextValue =
    value.slice(0, start) + before + content + after + value.slice(end);
  const nextStart = start + before.length;

  return {
    value: nextValue,
    selectionStart: nextStart,
    selectionEnd: nextStart + content.length,
  };
}

type LineMarkerOptions = {
  expression: RegExp;
  marker: string;
  isTarget: (marker: string) => boolean;
};

function toggleSelectedLineMarkers(
  value: string,
  start: number,
  end: number,
  options: LineMarkerOptions,
): TextEdit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const adjustedEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextLineBreak = value.indexOf("\n", adjustedEnd);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const matches = lines.map((line) => line.match(options.expression));
  const allTarget = matches.every(
    (match) => match && options.isTarget(match[2]),
  );
  const changed = lines
    .map((line, index) => {
      const match = matches[index];
      if (allTarget && match) {
        return match[1] + line.slice(match[0].length);
      }
      if (match) {
        return match[1] + options.marker + line.slice(match[0].length);
      }
      const indent = line.match(/^\s*/)?.[0] ?? "";
      return indent + options.marker + line.slice(indent.length);
    })
    .join("\n");

  return {
    value: value.slice(0, lineStart) + changed + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + changed.length,
  };
}

function createCallout(
  value: string,
  start: number,
  end: number,
): TextEdit {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextLineBreak = value.indexOf("\n", end);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const selectedLines = value.slice(lineStart, lineEnd);
  const body = (selectedLines || "在这里输入提示内容")
    .split("\n")
    .map((line) => "> " + line)
    .join("\n");
  const callout = "> [!note] 提示\n" + body;
  const contentOffset = callout.indexOf(body);

  return {
    value: value.slice(0, lineStart) + callout + value.slice(lineEnd),
    selectionStart: lineStart + contentOffset + 2,
    selectionEnd: lineStart + callout.length,
  };
}

function nextFootnoteId(value: string): string {
  let highestId = 0;
  for (const match of value.matchAll(/\[\^(\d+)\]/g)) {
    highestId = Math.max(highestId, Number.parseInt(match[1], 10));
  }
  return String(highestId + 1);
}

function createFootnote(
  value: string,
  start: number,
  end: number,
): TextEdit {
  const id = nextFootnoteId(value);
  const reference = "[^" + id + "]";
  const selected = value.slice(start, end);
  const withReference =
    value.slice(0, start) + selected + reference + value.slice(end);
  const separator = withReference.endsWith("\n\n")
    ? ""
    : withReference.endsWith("\n")
      ? "\n"
      : "\n\n";
  const definition = "[^" + id + "]: 脚注内容";
  const nextValue = withReference + separator + definition;
  const selectionStart =
    withReference.length + separator.length + definition.indexOf("脚注内容");

  return {
    value: nextValue,
    selectionStart,
    selectionEnd: selectionStart + "脚注内容".length,
  };
}

export function insertText(
  value: string,
  start: number,
  end: number,
  text: string,
): TextEdit {
  const nextCursor = start + text.length;
  return {
    value: value.slice(0, start) + text + value.slice(end),
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export function applyEditorAction(
  value: string,
  start: number,
  end: number,
  action: EditorAction,
): TextEdit {
  switch (action) {
    case "heading":
      return toggleSelectedLineMarkers(value, start, end, {
        expression: /^(\s{0,3})(#{1,6}\s+)/,
        marker: "## ",
        isTarget: (marker) => /^##\s+$/.test(marker),
      });
    case "bold":
      return toggleWrapSelection(value, start, end, "**", "**", "粗体文本");
    case "italic":
      return toggleWrapSelection(value, start, end, "_", "_", "斜体文本");
    case "quote":
      return toggleSelectedLineMarkers(value, start, end, {
        expression: /^(\s*)(>\s?)/,
        marker: "> ",
        isTarget: (marker) => /^>\s?$/.test(marker),
      });
    case "bullet":
      return toggleSelectedLineMarkers(value, start, end, {
        expression: /^(\s*)((?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+))/,
        marker: "- ",
        isTarget: (marker) => /^[-*+]\s+$/.test(marker),
      });
    case "checklist":
      return toggleSelectedLineMarkers(value, start, end, {
        expression: /^(\s*)((?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+))/,
        marker: "- [ ] ",
        isTarget: (marker) => /^[-*+]\s+\[[ xX]\]\s+$/.test(marker),
      });
    case "highlight":
      return toggleWrapSelection(value, start, end, "==", "==", "高亮文本");
    case "wikilink":
      return toggleWrapSelection(value, start, end, "[[", "]]", "笔记名称");
    case "callout":
      return createCallout(value, start, end);
    case "footnote":
      return createFootnote(value, start, end);
    case "inline-code":
      return toggleWrapSelection(
        value,
        start,
        end,
        INLINE_CODE,
        INLINE_CODE,
        "code",
      );
    case "code-block":
      return toggleWrapSelection(
        value,
        start,
        end,
        CODE_FENCE + "\n",
        "\n" + CODE_FENCE,
        "在这里输入代码",
      );
    case "link":
      return toggleWrapSelection(
        value,
        start,
        end,
        "[",
        "](https://example.com)",
        "链接文字",
      );
    case "inline-math":
      return toggleWrapSelection(value, start, end, "$", "$", "E = mc^2");
    case "block-math":
      return toggleWrapSelection(
        value,
        start,
        end,
        "$$\n",
        "\n$$",
        "\\frac{a}{b}",
      );
  }
}

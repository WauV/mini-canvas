import { type EditorState, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";
import {
  type MarkdownLine,
  type ObsidianToken,
  type ParsedObsidianMarkdown,
  parseObsidianMarkdown,
  type TextRange,
} from "./obsidian-markdown.ts";

function focusSource(
  view: EditorView,
  from: number,
  to: number,
  offset = 0,
): void {
  const anchor = Math.min(to, from + offset);
  view.dispatch({
    selection: { anchor },
    scrollIntoView: true,
  });
  view.focus();
}

class MathWidget extends WidgetType {
  readonly latex: string;
  readonly displayMode: boolean;
  readonly from: number;
  readonly to: number;

  constructor(
    latex: string,
    displayMode: boolean,
    from: number,
    to: number,
  ) {
    super();
    this.latex = latex;
    this.displayMode = displayMode;
    this.from = from;
    this.to = to;
  }

  eq(other: MathWidget): boolean {
    return (
      this.latex === other.latex &&
      this.displayMode === other.displayMode &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.displayMode ? "div" : "span");
    element.className = this.displayMode
      ? "cm-live-math cm-live-math-block"
      : "cm-live-math cm-live-math-inline";
    element.title = "点击编辑 LaTeX 源码";
    katex.render(this.latex, element, {
      displayMode: this.displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      focusSource(view, this.from, this.to, this.displayMode ? 3 : 1);
    });
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class WikiLinkWidget extends WidgetType {
  readonly target: string;
  readonly label: string;
  readonly embed: boolean;
  readonly from: number;
  readonly to: number;

  constructor(
    target: string,
    label: string,
    embed: boolean,
    from: number,
    to: number,
  ) {
    super();
    this.target = target;
    this.label = label;
    this.embed = embed;
    this.from = from;
    this.to = to;
  }

  eq(other: WikiLinkWidget): boolean {
    return (
      this.target === other.target &&
      this.label === other.label &&
      this.embed === other.embed &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = this.embed
      ? "cm-obsidian-embed-widget"
      : "cm-obsidian-wikilink-widget";
    element.title = this.target + " · 点击编辑源文本";

    const icon = document.createElement("span");
    icon.className = "cm-widget-icon";
    icon.textContent = this.embed ? "▣" : "↗";

    const label = document.createElement("span");
    label.textContent = this.embed ? "嵌入 · " + this.label : this.label;

    element.append(icon, label);
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      focusSource(view, this.from, this.to, this.embed ? 3 : 2);
    });
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class AttachmentWidget extends WidgetType {
  readonly label: string;
  readonly target: string;
  readonly from: number;
  readonly to: number;

  constructor(
    label: string,
    target: string,
    from: number,
    to: number,
  ) {
    super();
    this.label = label;
    this.target = target;
    this.from = from;
    this.to = to;
  }

  eq(other: AttachmentWidget): boolean {
    return (
      this.label === other.label &&
      this.target === other.target &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-obsidian-embed-widget";
    element.title = this.target + " · 点击编辑源文本";
    element.textContent = "图片 · " + (this.label || this.target);
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      focusSource(view, this.from, this.to, 2);
    });
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class TaskWidget extends WidgetType {
  readonly checked: boolean;
  readonly checkFrom: number;

  constructor(
    checked: boolean,
    checkFrom: number,
  ) {
    super();
    this.checked = checked;
    this.checkFrom = checkFrom;
  }

  eq(other: TaskWidget): boolean {
    return this.checked === other.checked && this.checkFrom === other.checkFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-task-widget";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.setAttribute(
      "aria-label",
      this.checked ? "标记为未完成" : "标记为已完成",
    );
    checkbox.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.checkFrom,
          to: this.checkFrom + 1,
          insert: checkbox.checked ? "x" : " ",
        },
      });
      view.focus();
    });
    wrapper.appendChild(checkbox);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class TextMarkerWidget extends WidgetType {
  readonly text: string;
  readonly className: string;
  readonly from: number;
  readonly to: number;

  constructor(
    text: string,
    className: string,
    from: number,
    to: number,
  ) {
    super();
    this.text = text;
    this.className = className;
    this.from = from;
    this.to = to;
  }

  eq(other: TextMarkerWidget): boolean {
    return (
      this.text === other.text &&
      this.className === other.className &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = this.className;
    element.textContent = this.text;
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      focusSource(view, this.from, this.to);
    });
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class FootnoteWidget extends WidgetType {
  readonly label: string;
  readonly title: string;
  readonly inline: boolean;
  readonly from: number;
  readonly to: number;

  constructor(
    label: string,
    title: string,
    inline: boolean,
    from: number,
    to: number,
  ) {
    super();
    this.label = label;
    this.title = title;
    this.inline = inline;
    this.from = from;
    this.to = to;
  }

  eq(other: FootnoteWidget): boolean {
    return (
      this.label === other.label &&
      this.title === other.title &&
      this.inline === other.inline &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("sup");
    element.className = this.inline
      ? "cm-footnote-widget cm-footnote-inline-widget"
      : "cm-footnote-widget";
    element.textContent = this.label;
    element.title = this.title + " · 点击编辑脚注源码";
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      focusSource(view, this.from, this.to, 2);
    });
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class HorizontalRuleWidget extends WidgetType {
  readonly from: number;
  readonly to: number;

  constructor(from: number, to: number) {
    super();
    this.from = from;
    this.to = to;
  }

  eq(other: HorizontalRuleWidget): boolean {
    return this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-horizontal-rule-widget";
    element.setAttribute("aria-label", "分隔线");
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      focusSource(view, this.from, this.to);
    });
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class TableWidget extends WidgetType {
  readonly header: string[];
  readonly rows: string[][];
  readonly from: number;
  readonly to: number;

  constructor(
    header: string[],
    rows: string[][],
    from: number,
    to: number,
  ) {
    super();
    this.header = header;
    this.rows = rows;
    this.from = from;
    this.to = to;
  }

  eq(other: TableWidget): boolean {
    return (
      this.from === other.from &&
      this.to === other.to &&
      JSON.stringify(this.header) === JSON.stringify(other.header) &&
      JSON.stringify(this.rows) === JSON.stringify(other.rows)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-widget";
    wrapper.title = "点击编辑 Markdown 表格";

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const value of this.header) {
      const cell = document.createElement("th");
      cell.textContent = value;
      headRow.appendChild(cell);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of this.rows) {
      const tableRow = document.createElement("tr");
      for (const value of row) {
        const cell = document.createElement("td");
        cell.textContent = value;
        tableRow.appendChild(cell);
      }
      tbody.appendChild(tableRow);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);

    wrapper.addEventListener("mousedown", (event) => {
      event.preventDefault();
      focusSource(view, this.from, this.to);
    });
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function selectionTouches(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) return range.head >= from && range.head <= to;
    return range.from <= to && range.to >= from;
  });
}

function addLineDecoration(
  ranges: Range<Decoration>[],
  line: MarkdownLine,
  className: string,
): void {
  ranges.push(
    Decoration.line({ attributes: { class: className } }).range(line.from),
  );
}

function addMarkerReplacements(
  ranges: Range<Decoration>[],
  markerRanges: TextRange[] | undefined,
): void {
  for (const marker of markerRanges ?? []) {
    if (marker.to > marker.from) {
      ranges.push(Decoration.replace({}).range(marker.from, marker.to));
    }
  }
}

function linesInside(
  lines: MarkdownLine[],
  token: ObsidianToken,
): MarkdownLine[] {
  return lines.filter(
    (line) => line.from >= token.from && line.to <= token.to,
  );
}

function tokenTextData(
  token: ObsidianToken,
  key: string,
  fallback = "",
): string {
  const value = token.data?.[key];
  return typeof value === "string" ? value : fallback;
}

function tokenNumberData(
  token: ObsidianToken,
  key: string,
  fallback = 0,
): number {
  const value = token.data?.[key];
  return typeof value === "number" ? value : fallback;
}

function tokenBooleanData(
  token: ObsidianToken,
  key: string,
): boolean {
  return token.data?.[key] === true;
}

function buildDecorations(
  state: EditorState,
  parsed: ParsedObsidianMarkdown,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const token of parsed.tokens) {
    const active = selectionTouches(state, token.from, token.to);

    switch (token.kind) {
      case "frontmatter": {
        const blockLines = linesInside(parsed.lines, token);
        for (const line of blockLines) {
          addLineDecoration(ranges, line, "cm-frontmatter-line");
        }
        if (!active && token.markerRanges?.length === 2) {
          const [opening, closing] = token.markerRanges;
          ranges.push(
            Decoration.replace({
              widget: new TextMarkerWidget(
                "属性",
                "cm-frontmatter-label",
                token.from,
                token.to,
              ),
            }).range(opening.from, opening.to),
          );
          ranges.push(Decoration.replace({}).range(closing.from, closing.to));
        }
        break;
      }

      case "code-block": {
        const blockLines = linesInside(parsed.lines, token);
        for (const [index, line] of blockLines.entries()) {
          const edgeClass =
            index === 0
              ? " cm-code-block-first"
              : index === blockLines.length - 1
                ? " cm-code-block-last"
                : "";
          addLineDecoration(
            ranges,
            line,
            "cm-code-block-line" + edgeClass,
          );
        }
        if (!active) addMarkerReplacements(ranges, token.markerRanges);
        break;
      }

      case "block-math": {
        if (active) {
          for (const line of linesInside(parsed.lines, token)) {
            addLineDecoration(ranges, line, "cm-math-source-line");
          }
        } else {
          ranges.push(
            Decoration.replace({
              widget: new MathWidget(
                tokenTextData(token, "latex"),
                true,
                token.from,
                token.to,
              ),
              block: true,
            }).range(token.from, token.to),
          );
        }
        break;
      }

      case "table": {
        if (active) {
          for (const line of linesInside(parsed.lines, token)) {
            addLineDecoration(ranges, line, "cm-table-source-line");
          }
        } else {
          const headerValue = token.data?.header;
          const rowValue = token.data?.rows;
          const header = Array.isArray(headerValue)
            ? headerValue.filter(
                (value): value is string => typeof value === "string",
              )
            : [];
          const rows = Array.isArray(rowValue)
            ? rowValue
                .filter(
                  (value): value is string => typeof value === "string",
                )
                .map((row) => row.split("\u001f"))
            : [];
          ranges.push(
            Decoration.replace({
              widget: new TableWidget(header, rows, token.from, token.to),
              block: true,
            }).range(token.from, token.to),
          );
        }
        break;
      }

      case "callout": {
        const calloutType = tokenTextData(token, "calloutType", "note");
        const title = calloutType.toUpperCase();
        const blockLines = linesInside(parsed.lines, token);
        for (const [index, line] of blockLines.entries()) {
          const edgeClasses = [
            index === 0 ? "cm-callout-first" : "",
            index === blockLines.length - 1 ? "cm-callout-last" : "",
          ]
            .filter(Boolean)
            .join(" ");
          addLineDecoration(
            ranges,
            line,
            "cm-callout-line cm-callout-" +
              calloutType +
              (edgeClasses ? " " + edgeClasses : ""),
          );
        }
        if (!active && token.markerRanges?.length) {
          const [opening, ...continuations] = token.markerRanges;
          ranges.push(
            Decoration.replace({
              widget: new TextMarkerWidget(
                title,
                "cm-callout-label",
                token.from,
                token.to,
              ),
            }).range(opening.from, opening.to),
          );
          addMarkerReplacements(ranges, continuations);
        }
        break;
      }

      case "footnote-definition": {
        const line = parsed.lines.find((item) => item.from === token.from);
        if (line) {
          addLineDecoration(ranges, line, "cm-footnote-definition-line");
        }
        if (!active && token.markerRanges?.[0]) {
          const marker = token.markerRanges[0];
          ranges.push(
            Decoration.replace({
              widget: new TextMarkerWidget(
                "脚注 " + tokenTextData(token, "id"),
                "cm-footnote-definition-label",
                token.from,
                token.to,
              ),
            }).range(marker.from, marker.to),
          );
        }
        break;
      }

      case "heading": {
        const line = parsed.lines.find((item) => item.from === token.from);
        const level = tokenNumberData(token, "level", 1);
        if (line) {
          addLineDecoration(
            ranges,
            line,
            "cm-heading-line cm-heading-" + level,
          );
        }
        if (!active) addMarkerReplacements(ranges, token.markerRanges);
        break;
      }

      case "task": {
        const marker = token.markerRanges?.[0];
        if (marker) {
          ranges.push(
            Decoration.replace({
              widget: new TaskWidget(
                tokenBooleanData(token, "checked"),
                tokenNumberData(token, "checkFrom"),
              ),
            }).range(marker.from, marker.to),
          );
        }
        if (tokenBooleanData(token, "checked") && token.contentFrom !== undefined) {
          ranges.push(
            Decoration.mark({ class: "cm-task-completed" }).range(
              token.contentFrom,
              token.contentTo ?? token.to,
            ),
          );
        }
        break;
      }

      case "bullet":
      case "ordered-list": {
        if (!active && token.markerRanges?.[0]) {
          const marker = token.markerRanges[0];
          const text =
            token.kind === "bullet"
              ? "•"
              : tokenTextData(token, "order", "1") + ".";
          ranges.push(
            Decoration.replace({
              widget: new TextMarkerWidget(
                text,
                "cm-list-marker-widget",
                token.from,
                token.to,
              ),
            }).range(marker.from, marker.to),
          );
        }
        break;
      }

      case "blockquote": {
        const line = parsed.lines.find((item) => item.from === token.from);
        if (line) addLineDecoration(ranges, line, "cm-blockquote-line");
        if (!active) addMarkerReplacements(ranges, token.markerRanges);
        break;
      }

      case "horizontal-rule": {
        if (!active) {
          ranges.push(
            Decoration.replace({
              widget: new HorizontalRuleWidget(token.from, token.to),
              block: true,
            }).range(token.from, token.to),
          );
        }
        break;
      }

      case "comment": {
        if (!active) {
          ranges.push(
            Decoration.replace({
              widget: new TextMarkerWidget(
                "隐藏注释",
                "cm-comment-widget",
                token.from,
                token.to,
              ),
            }).range(token.from, token.to),
          );
        } else {
          ranges.push(
            Decoration.mark({ class: "cm-comment-source" }).range(
              token.from,
              token.to,
            ),
          );
        }
        break;
      }

      case "wiki-link":
      case "embed": {
        if (!active) {
          ranges.push(
            Decoration.replace({
              widget: new WikiLinkWidget(
                tokenTextData(token, "target"),
                tokenTextData(token, "label"),
                token.kind === "embed",
                token.from,
                token.to,
              ),
            }).range(token.from, token.to),
          );
        } else {
          ranges.push(
            Decoration.mark({
              class:
                token.kind === "embed"
                  ? "cm-embed-source"
                  : "cm-wikilink-source",
            }).range(token.from, token.to),
          );
        }
        break;
      }

      case "markdown-image": {
        if (!active) {
          ranges.push(
            Decoration.replace({
              widget: new AttachmentWidget(
                tokenTextData(token, "label"),
                tokenTextData(token, "target"),
                token.from,
                token.to,
              ),
            }).range(token.from, token.to),
          );
        }
        break;
      }

      case "markdown-link": {
        if (token.contentFrom !== undefined && token.contentTo !== undefined) {
          ranges.push(
            Decoration.mark({ class: "cm-markdown-link" }).range(
              token.contentFrom,
              token.contentTo,
            ),
          );
        }
        if (!active) addMarkerReplacements(ranges, token.markerRanges);
        break;
      }

      case "footnote-reference":
      case "inline-footnote": {
        if (!active) {
          const inline = token.kind === "inline-footnote";
          const label = inline ? "注" : tokenTextData(token, "id");
          const title = inline
            ? tokenTextData(token, "content")
            : "脚注 " + label;
          ranges.push(
            Decoration.replace({
              widget: new FootnoteWidget(
                label,
                title,
                inline,
                token.from,
                token.to,
              ),
            }).range(token.from, token.to),
          );
        } else {
          ranges.push(
            Decoration.mark({ class: "cm-footnote-source" }).range(
              token.from,
              token.to,
            ),
          );
        }
        break;
      }

      case "inline-math": {
        if (!active) {
          ranges.push(
            Decoration.replace({
              widget: new MathWidget(
                tokenTextData(token, "latex"),
                false,
                token.from,
                token.to,
              ),
            }).range(token.from, token.to),
          );
        } else {
          ranges.push(
            Decoration.mark({ class: "cm-math-source" }).range(
              token.from,
              token.to,
            ),
          );
        }
        break;
      }

      case "strong":
      case "emphasis":
      case "strikethrough":
      case "highlight":
      case "inline-code": {
        if (token.contentFrom !== undefined && token.contentTo !== undefined) {
          const classNames: Record<string, string> = {
            strong: "cm-live-strong",
            emphasis: "cm-live-emphasis",
            strikethrough: "cm-live-strikethrough",
            highlight: "cm-live-highlight",
            "inline-code": "cm-live-inline-code",
          };
          ranges.push(
            Decoration.mark({ class: classNames[token.kind] }).range(
              token.contentFrom,
              token.contentTo,
            ),
          );
        }
        if (!active) addMarkerReplacements(ranges, token.markerRanges);
        break;
      }

      case "tag": {
        ranges.push(
          Decoration.mark({ class: "cm-obsidian-tag" }).range(
            token.from,
            token.to,
          ),
        );
        break;
      }

      case "block-id": {
        if (!active) {
          ranges.push(
            Decoration.replace({
              widget: new TextMarkerWidget(
                tokenTextData(token, "id"),
                "cm-block-id-widget",
                token.from,
                token.to,
              ),
            }).range(token.from, token.to),
          );
        } else {
          ranges.push(
            Decoration.mark({ class: "cm-block-id-source" }).range(
              token.from,
              token.to,
            ),
          );
        }
        break;
      }
    }
  }

  return Decoration.set(ranges, true);
}

type LivePreviewState = {
  parsed: ParsedObsidianMarkdown;
  decorations: DecorationSet;
};

export type ObsidianMarkdownParser = (
  source: string,
) => ParsedObsidianMarkdown;

export function createObsidianLivePreview(
  parser: ObsidianMarkdownParser = parseObsidianMarkdown,
): StateField<LivePreviewState> {
  return StateField.define<LivePreviewState>({
    create(state) {
      const parsed = parser(state.doc.toString());
      return {
        parsed,
        decorations: buildDecorations(state, parsed),
      };
    },
    update(value, transaction) {
      const selectionChanged = !transaction.startState.selection.eq(
        transaction.state.selection,
      );
      if (!transaction.docChanged && !selectionChanged) return value;

      const parsed = transaction.docChanged
        ? parser(transaction.state.doc.toString())
        : value.parsed;
      return {
        parsed,
        decorations: buildDecorations(transaction.state, parsed),
      };
    },
    provide(field) {
      return EditorView.decorations.from(
        field,
        (value) => value.decorations,
      );
    },
  });
}

export const obsidianLivePreview = createObsidianLivePreview();

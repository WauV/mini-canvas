const MAX_SVG_SOURCE_LENGTH = 500_000;
const MAX_SVG_ELEMENT_COUNT = 2_000;

const BLOCKED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "canvas",
  "link",
  "meta",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
]);

export type SanitizedSvg = {
  markup: string | null;
  error: string | null;
};

function unwrapCssUrl(value: string): string[] {
  return Array.from(value.matchAll(/url\(([^)]+)\)/giu), (match) =>
    match[1].trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, "$1$2"),
  );
}

function containsUnsafeReference(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020]+/gu, "").toLowerCase();
  if (
    normalized.includes("javascript:") ||
    normalized.includes("vbscript:") ||
    normalized.includes("file:") ||
    normalized.includes("@import") ||
    normalized.includes("expression(") ||
    normalized.includes("-moz-binding")
  ) {
    return true;
  }

  return unwrapCssUrl(value).some((reference) => !reference.startsWith("#"));
}

function isSafeHref(value: string): boolean {
  const normalized = value.trim();
  if (normalized.startsWith("#")) return true;

  return /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/iu.test(
    normalized,
  );
}

export function sanitizeSvgMarkup(source: string): SanitizedSvg {
  if (source.trim().length === 0) {
    return { markup: null, error: "SVG 内容为空" };
  }
  if (source.length > MAX_SVG_SOURCE_LENGTH) {
    return { markup: null, error: "SVG 超过 500 KB 预览上限" };
  }
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return { markup: null, error: "当前环境不支持 SVG 预览" };
  }

  try {
    const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
    if (parsed.querySelector("parsererror")) {
      return { markup: null, error: "SVG XML 格式不完整" };
    }

    const root = parsed.documentElement;
    if (root.localName.toLowerCase() !== "svg") {
      return { markup: null, error: "SVG 必须以 <svg> 元素开始" };
    }

    const elements = [root, ...Array.from(root.querySelectorAll("*"))];
    if (elements.length > MAX_SVG_ELEMENT_COUNT) {
      return { markup: null, error: "SVG 元素过多，已停止预览" };
    }

    for (const element of elements) {
      if (BLOCKED_ELEMENTS.has(element.localName.toLowerCase())) {
        element.remove();
        continue;
      }

      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.localName.toLowerCase();
        const qualifiedName = attribute.name.toLowerCase();
        const value = attribute.value;

        if (
          name.startsWith("on") ||
          qualifiedName === "target" ||
          containsUnsafeReference(value)
        ) {
          element.removeAttributeNode(attribute);
          continue;
        }

        if (
          (name === "href" || qualifiedName === "xlink:href") &&
          !isSafeHref(value)
        ) {
          element.removeAttributeNode(attribute);
        }
      }

      if (
        element.localName.toLowerCase() === "style" &&
        containsUnsafeReference(element.textContent ?? "")
      ) {
        element.remove();
      }
    }

    if (!root.hasAttribute("xmlns")) {
      root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    return {
      markup: new XMLSerializer().serializeToString(root),
      error: null,
    };
  } catch {
    return { markup: null, error: "SVG 解析失败" };
  }
}

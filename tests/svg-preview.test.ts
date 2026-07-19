import assert from "node:assert/strict";
import { test } from "vitest";

import { sanitizeSvgMarkup } from "../app/lib/svg-preview.ts";

test("keeps ordinary SVG geometry and adds the SVG namespace", () => {
  const result = sanitizeSvgMarkup(
    '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" /></svg>',
  );

  assert.equal(result.error, null);
  assert.match(result.markup ?? "", /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
  assert.match(result.markup ?? "", /<circle/u);
  assert.match(result.markup ?? "", /viewBox="0 0 20 20"/u);
});

test("removes executable elements, handlers and external references", () => {
  const source = [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
    "<script>alert(1)</script>",
    '<foreignObject><div>HTML</div></foreignObject>',
    '<a href="https://example.com"><rect width="10" height="10" /></a>',
    '<image href="file:///secret" />',
    '<rect style="fill:url(https://example.com/a.svg)" />',
    '<style>@import url(https://example.com/theme.css)</style>',
    "</svg>",
  ].join("");
  const result = sanitizeSvgMarkup(source);

  assert.equal(result.error, null);
  assert.doesNotMatch(result.markup ?? "", /script|foreignObject|onload/iu);
  assert.doesNotMatch(result.markup ?? "", /https:|file:|@import/iu);
});

test("allows local fragment links and embedded raster image data", () => {
  const result = sanitizeSvgMarkup(
    [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<defs><path id="shape" d="M0 0h1v1z" /></defs>',
      '<use href="#shape" />',
      '<image href="data:image/png;base64,iVBORw0KGgo=" />',
      "</svg>",
    ].join(""),
  );

  assert.equal(result.error, null);
  assert.match(result.markup ?? "", /href="#shape"/u);
  assert.match(result.markup ?? "", /data:image\/png;base64,iVBORw0KGgo=/u);
});

test("reports empty, malformed, wrong-root and oversized SVG input", () => {
  assert.equal(sanitizeSvgMarkup("  ").error, "SVG 内容为空");
  assert.equal(
    sanitizeSvgMarkup("<svg><circle></svg>").error,
    "SVG XML 格式不完整",
  );
  assert.equal(
    sanitizeSvgMarkup("<html></html>").error,
    "SVG 必须以 <svg> 元素开始",
  );
  assert.equal(
    sanitizeSvgMarkup(`<svg>${" ".repeat(500_001)}</svg>`).error,
    "SVG 超过 500 KB 预览上限",
  );
});

test("stops rendering SVG documents with excessive element counts", () => {
  const source = `<svg>${"<g />".repeat(2_001)}</svg>`;
  const result = sanitizeSvgMarkup(source);

  assert.equal(result.markup, null);
  assert.equal(result.error, "SVG 元素过多，已停止预览");
});

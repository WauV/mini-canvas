import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom does not perform layout, while CodeMirror measures DOM ranges during
// animation frames. Stable zero-sized geometry lets us exercise the real
// editor without pretending that jsdom can calculate browser layout.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
if (!URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:mini-canvas-test"),
  });
}
if (!URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  if (vi.isMockFunction(URL.createObjectURL)) {
    vi.mocked(URL.createObjectURL).mockClear();
  }
  if (vi.isMockFunction(URL.revokeObjectURL)) {
    vi.mocked(URL.revokeObjectURL).mockClear();
  }
  window.localStorage.clear();
});

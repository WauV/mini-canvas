import assert from "node:assert/strict";
import { test } from "vitest";

import { EDITOR_TOOLS } from "../app/api/mcp-tools/route.ts";

test("local editor proxy allows the attachment tool used by Embed previews", () => {
  assert.equal(EDITOR_TOOLS.has("read_attachment"), true);
});

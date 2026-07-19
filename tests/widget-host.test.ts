import assert from "node:assert/strict";
import { test } from "vitest";

import { parseWidgetLaunch } from "../app/lib/mcp/use-widget-host.ts";

test("parses picker and draft Widget launch payloads", () => {
  assert.deepEqual(
    parseWidgetLaunch({ structuredContent: { mode: "picker" } }),
    { mode: "picker" },
  );
  assert.deepEqual(
    parseWidgetLaunch({
      structuredContent: { mode: "draft", draftId: "draft-1" },
    }),
    { mode: "draft", draftId: "draft-1" },
  );
});

test("reports host tool errors and malformed launch payloads", () => {
  assert.throws(
    () =>
      parseWidgetLaunch({
        isError: true,
        content: [{ type: "text", text: "宿主拒绝了启动" }],
      }),
    /宿主拒绝了启动/u,
  );
  assert.throws(
    () => parseWidgetLaunch({ structuredContent: { mode: "draft" } }),
    /没有收到可打开的草稿/u,
  );
  assert.throws(
    () => parseWidgetLaunch({ structuredContent: null }),
    /启动数据格式无效/u,
  );
});

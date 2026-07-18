import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(path, "http://localhost/"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the mini canvas shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Mini Canvas<\/title>/i);
  assert.match(html, /Markdown · LaTeX/);
  assert.match(html, /id="markdown-editor"/);
  assert.doesNotMatch(html, /所见即所得编辑/);
  assert.match(html, /字词/);
  assert.match(html, /Live Preview/);
  assert.match(html, /选择工作区视图/);
  assert.match(html, /Markdown 格式/);
  assert.match(html, /原文保真/);
  assert.match(html, /打开笔记/);
  assert.match(html, /已保存到本机/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("production build does not enable the local MCP proxy without server secrets", async () => {
  const response = await render("/api/mcp-tools");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { available: false });
});

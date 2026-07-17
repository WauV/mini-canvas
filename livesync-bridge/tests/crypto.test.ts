import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { LiveSyncV2Crypto } from "../src/crypto.ts";

test("LiveSync V2 crypto preserves Chinese, emoji and LaTeX", async () => {
  const crypto = new LiveSyncV2Crypto(
    "test-only-passphrase",
    Uint8Array.from(randomBytes(32)),
  );
  const source = "中文：窗前明月光 🌙🚀\\n公式：$E = mc^2$";
  const encrypted = await crypto.encrypt(source);
  assert.match(encrypted, /^%=/u);
  assert.equal(await crypto.decrypt(encrypted), source);
});

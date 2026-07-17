import assert from "node:assert/strict";
import test from "node:test";

import { xxhash64 } from "../src/hash.ts";

test("xxHash64 matches the official empty-input vector", () => {
  assert.equal(xxhash64("").toString(16), "ef46db3751d8e999");
});

test("xxHash64 hashes UTF-8 input deterministically", () => {
  assert.equal(xxhash64("a").toString(16), "d24ec4f1a98c6e5b");
  assert.equal(xxhash64("中文🌙"), xxhash64("中文🌙"));
});

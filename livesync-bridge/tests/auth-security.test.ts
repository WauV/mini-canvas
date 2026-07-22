import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthenticationThrottle,
  constantTimeTokenEqual,
} from "../src/auth-security.ts";
import { API_SECURITY_HEADERS } from "../src/http-security.ts";

test("Bearer tokens compare through fixed-length digests", () => {
  assert.equal(constantTimeTokenEqual("a".repeat(32), "a".repeat(32)), true);
  assert.equal(constantTimeTokenEqual("short", "a".repeat(32)), false);
  assert.equal(constantTimeTokenEqual("a".repeat(31) + "b", "a".repeat(32)), false);
  assert.equal(constantTimeTokenEqual("x".repeat(4_097), "x".repeat(4_097)), false);
});

test("authentication throttling only blocks repeated failures for its window", () => {
  let now = 1_000;
  const throttle = new AuthenticationThrottle({
    maxFailures: 2,
    windowMs: 5_000,
    now: () => now,
  });

  throttle.recordFailure("client-a");
  assert.equal(throttle.retryAfterSeconds("client-a"), 0);
  throttle.recordFailure("client-a");
  assert.equal(throttle.retryAfterSeconds("client-a"), 5);
  assert.equal(throttle.retryAfterSeconds("client-b"), 0);

  throttle.recordSuccess("client-a");
  assert.equal(throttle.retryAfterSeconds("client-a"), 0);
  throttle.recordFailure("client-a");
  throttle.recordFailure("client-a");
  now += 5_001;
  assert.equal(throttle.retryAfterSeconds("client-a"), 0);
});

test("API responses use restrictive browser security headers", () => {
  assert.match(API_SECURITY_HEADERS["Content-Security-Policy"], /default-src 'none'/u);
  assert.equal(API_SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
  assert.equal(API_SECURITY_HEADERS["Cache-Control"], "no-store");
});

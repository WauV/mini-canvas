import { createHash, timingSafeEqual } from "node:crypto";

const MAX_TOKEN_BYTES = 4 * 1024;
const DEFAULT_MAX_FAILURES = 20;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 1_024;

function tokenDigest(value: string): Buffer {
  return createHash("sha256")
    .update("mini-canvas/bearer-token/v1\0", "utf8")
    .update(value, "utf8")
    .digest();
}

export function constantTimeTokenEqual(
  provided: string,
  expected: string,
): boolean {
  if (
    Buffer.byteLength(provided, "utf8") > MAX_TOKEN_BYTES ||
    Buffer.byteLength(expected, "utf8") > MAX_TOKEN_BYTES
  ) {
    return false;
  }
  return timingSafeEqual(tokenDigest(provided), tokenDigest(expected));
}

type FailureWindow = {
  failures: number;
  resetAt: number;
};

export class AuthenticationThrottle {
  private readonly windows = new Map<string, FailureWindow>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: {
    maxFailures?: number;
    windowMs?: number;
    now?: () => number;
  } = {}) {
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxFailures) || this.maxFailures < 1) {
      throw new Error("maxFailures 必须是正整数");
    }
    if (!Number.isFinite(this.windowMs) || this.windowMs < 1) {
      throw new Error("windowMs 必须是正数");
    }
  }

  retryAfterSeconds(key: string): number {
    const current = this.windows.get(key);
    if (!current) return 0;
    const now = this.now();
    if (current.resetAt <= now) {
      this.windows.delete(key);
      return 0;
    }
    if (current.failures < this.maxFailures) return 0;
    return Math.max(1, Math.ceil((current.resetAt - now) / 1_000));
  }

  recordFailure(key: string): void {
    const now = this.now();
    const current = this.windows.get(key);
    if (current && current.resetAt > now) {
      current.failures += 1;
      return;
    }
    if (!current && this.windows.size >= MAX_TRACKED_CLIENTS) {
      const oldest = this.windows.keys().next().value as string | undefined;
      if (oldest !== undefined) this.windows.delete(oldest);
    }
    this.windows.set(key, { failures: 1, resetAt: now + this.windowMs });
  }

  recordSuccess(key: string): void {
    this.windows.delete(key);
  }
}

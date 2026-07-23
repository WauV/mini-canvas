import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";

import { normalisePath } from "../../livesync-bridge/src/bridge.ts";
import { constantTimeTokenEqual } from "../../livesync-bridge/src/auth-security.ts";
import { MCP_SCOPES, type McpScope, type Principal } from "./types.ts";

export class AuthenticationError extends Error {
  constructor(message = "认证失败") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "权限不足") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type StaticTokenRecord = Principal & { token: string; expiresAt?: number };

function tokenEquals(provided: string, expected: string): boolean {
  return constantTimeTokenEqual(provided, expected);
}

function normalizeAllowedPath(path: string): string {
  if (path === "") return "";
  return normalisePath(path).replace(/\/$/u, "");
}

export function validatePrincipal(value: Principal): Principal {
  if (!value.userId.trim()) throw new Error("userId 不能为空");
  const tenantId = value.tenantId.trim();
  if (
    !tenantId ||
    tenantId.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(tenantId)
  ) {
    throw new Error("tenantId 必须是 1 到 200 个不含控制字符的字符");
  }
  if (value.scopes.some((scope) => !MCP_SCOPES.includes(scope))) {
    throw new Error(`用户 ${value.userId} 包含未知 scope`);
  }
  return {
    userId: value.userId.trim(),
    tenantId,
    scopes: [...new Set(value.scopes)],
    allowedPaths: [...new Set(value.allowedPaths.map(normalizeAllowedPath))],
  };
}

export class StaticTokenVerifier implements OAuthTokenVerifier {
  private readonly records: StaticTokenRecord[];

  constructor(records: StaticTokenRecord[]) {
    if (records.length === 0) throw new Error("至少需要一个 MCP Bearer Token");
    if (new Set(records.map((record) => record.token)).size !== records.length) {
      throw new Error("MCP Bearer Token 不能重复绑定到多个身份");
    }
    this.records = records.map((record) => ({
      ...validatePrincipal(record),
      token: record.token,
      ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    }));
    if (this.records.some((record) => record.token.length < 32)) {
      throw new Error("MCP Bearer Token 至少需要 32 个字符");
    }
    if (
      this.records.some(
        (record) =>
          record.expiresAt !== undefined &&
          (!Number.isInteger(record.expiresAt) || record.expiresAt <= 0),
      )
    ) {
      throw new Error("MCP Bearer Token expiresAt 必须是正整数 Unix 秒时间戳");
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let record: StaticTokenRecord | undefined;
    const now = Math.floor(Date.now() / 1_000);
    for (const candidate of this.records) {
      if (
        tokenEquals(token, candidate.token) &&
        (candidate.expiresAt === undefined || candidate.expiresAt > now)
      ) {
        record = candidate;
      }
    }
    if (!record) throw new AuthenticationError();
    const principal: Principal = {
      userId: record.userId,
      tenantId: record.tenantId,
      scopes: record.scopes,
      allowedPaths: record.allowedPaths,
    };
    return {
      token,
      clientId: record.userId,
      scopes: record.scopes,
      expiresAt: record.expiresAt ?? 253_402_300_799,
      extra: { principal },
    };
  }
}

export function principalFromAuth(auth: AuthInfo | undefined): Principal {
  const value = auth?.extra?.principal;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthenticationError();
  }
  const candidate = value as Partial<Principal>;
  if (
    typeof candidate.userId !== "string" ||
    typeof candidate.tenantId !== "string" ||
    !Array.isArray(candidate.scopes) ||
    !Array.isArray(candidate.allowedPaths)
  ) {
    throw new AuthenticationError();
  }
  return validatePrincipal(candidate as Principal);
}

export class Authorizer {
  private readonly caseInsensitive: boolean;

  constructor(caseInsensitive = false) {
    this.caseInsensitive = caseInsensitive;
  }

  requireScope(principal: Principal, scope: McpScope): void {
    if (!principal.scopes.includes(scope)) {
      throw new AuthorizationError(`缺少权限 ${scope}`);
    }
  }

  requirePath(principal: Principal, rawPath: string): string {
    const path = normalisePath(rawPath);
    const comparablePath = this.caseInsensitive ? path.toLowerCase() : path;
    const allowed = principal.allowedPaths.some(
      (prefix) => {
        const comparablePrefix = this.caseInsensitive ? prefix.toLowerCase() : prefix;
        return (
          comparablePrefix === "" ||
          comparablePath === comparablePrefix ||
          comparablePath.startsWith(`${comparablePrefix}/`)
        );
      },
    );
    if (!allowed) throw new AuthorizationError(`没有访问路径 ${path} 的权限`);
    return path;
  }

  canAccessPath(principal: Principal, rawPath: string): boolean {
    try {
      this.requirePath(principal, rawPath);
      return true;
    } catch {
      return false;
    }
  }
}

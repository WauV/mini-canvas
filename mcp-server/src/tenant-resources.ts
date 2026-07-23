import { AuthorizationError } from "./auth.ts";
import type { NoteGateway } from "./bridge-client.ts";
import type { SearchCoordinator } from "./search.ts";

export type TenantResources = {
  gateway: NoteGateway;
  search: SearchCoordinator;
};

export interface TenantResourceProvider {
  resolve(tenantId: string): TenantResources;
}

export class StaticTenantResourceProvider implements TenantResourceProvider {
  private readonly resources = new Map<string, TenantResources>();

  constructor(entries: Iterable<readonly [string, TenantResources]>) {
    for (const [tenantId, resources] of entries) {
      const normalizedTenantId = tenantId.trim();
      if (!normalizedTenantId) throw new Error("tenantId 不能为空");
      if (resources.search.index.tenantId !== normalizedTenantId) {
        throw new Error(`租户资源与搜索索引不匹配：${normalizedTenantId}`);
      }
      if (this.resources.has(normalizedTenantId)) {
        throw new Error(`重复的租户资源：${normalizedTenantId}`);
      }
      this.resources.set(normalizedTenantId, resources);
    }
    if (this.resources.size === 0) throw new Error("至少需要一个租户资源");
  }

  resolve(tenantId: string): TenantResources {
    const resources = this.resources.get(tenantId);
    if (!resources) {
      throw new AuthorizationError("当前身份没有可用的 Vault 租户资源");
    }
    return resources;
  }
}

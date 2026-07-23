import { Authorizer, StaticTokenVerifier } from "./auth.ts";
import { BridgeHttpClient } from "./bridge-client.ts";
import type { McpConfig } from "./config.ts";
import { AtRestCrypto } from "./crypto.ts";
import { McpDatabase } from "./database.ts";
import { DraftRepository } from "./drafts.ts";
import { SearchCoordinator, SearchIndex } from "./search.ts";
import { MiniCanvasService } from "./service.ts";
import { StaticTenantResourceProvider } from "./tenant-resources.ts";

export type McpRuntime = {
  database: McpDatabase;
  drafts: DraftRepository;
  gateway: BridgeHttpClient;
  search: SearchCoordinator;
  service: MiniCanvasService;
  verifier: StaticTokenVerifier;
};

export function createMcpRuntime(config: McpConfig): McpRuntime {
  const database = new McpDatabase(config.databasePath, config.defaultTenantId);
  const crypto = new AtRestCrypto(config.masterKey, config.caseInsensitivePaths);
  const gateway = new BridgeHttpClient({
    baseUrl: config.bridgeUrl,
    token: config.bridgeToken,
  });
  const search = new SearchCoordinator(
    new SearchIndex(database, crypto, config.defaultTenantId),
    gateway,
  );
  const drafts = new DraftRepository(database, crypto);
  const service = new MiniCanvasService({
    drafts,
    resources: new StaticTenantResourceProvider([
      [config.defaultTenantId, { gateway, search }],
    ]),
    authorizer: new Authorizer(config.caseInsensitivePaths),
  });
  return {
    database,
    drafts,
    gateway,
    search,
    service,
    verifier: new StaticTokenVerifier(config.tokens),
  };
}

import type {
  EmbedResolutionRequest,
  ResolvedEmbed,
  WikiLinkNavigationRequest,
} from "../obsidian-interactions.ts";
import {
  resolveVaultLinkPath,
  VaultLinkResolutionError,
} from "../obsidian-links.ts";
import {
  MiniCanvasMcpClient,
  type ReadAttachmentResult,
  type VaultEntry,
} from "./mini-canvas-client.ts";

const CACHE_TTL_MS = 30_000;

type TimedPromise<T> = {
  expiresAt: number;
  value: Promise<T>;
};

function extension(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLocaleLowerCase("en-US");
}

export class VaultInteractionResolver {
  private readonly getClient: () => MiniCanvasMcpClient;
  private readonly now: () => number;
  private entriesCache: TimedPromise<VaultEntry[]> | null = null;
  private readonly attachmentCache = new Map<string, TimedPromise<ResolvedEmbed>>();

  constructor(
    getClient: () => MiniCanvasMcpClient,
    options: { now?: () => number } = {},
  ) {
    this.getClient = getClient;
    this.now = options.now ?? Date.now;
  }

  private entries(): Promise<VaultEntry[]> {
    const now = this.now();
    if (this.entriesCache && this.entriesCache.expiresAt > now) {
      return this.entriesCache.value;
    }
    const value = this.getClient()
      .listEntries()
      .catch((error: unknown) => {
        this.entriesCache = null;
        throw error;
      });
    this.entriesCache = { expiresAt: now + CACHE_TTL_MS, value };
    return value;
  }

  private async resolveAttachment(
    path: string,
    revision: string,
  ): Promise<ResolvedEmbed> {
    const key = `${path}\0${revision}`;
    const now = this.now();
    const cached = this.attachmentCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = this.getClient()
      .readAttachment(path)
      .then((attachment: ReadAttachmentResult): ResolvedEmbed => {
        const base = {
          path: attachment.path,
          mimeType: attachment.mimeType,
          revision: attachment.revision,
          size: attachment.size,
        };
        if (attachment.delivery === "image") {
          return {
            ...base,
            kind: "image",
            source: `data:${attachment.mimeType};base64,${attachment.data}`,
          };
        }
        if (attachment.delivery === "text") {
          return attachment.mimeType === "image/svg+xml" || extension(path) === ".svg"
            ? { ...base, kind: "svg", source: attachment.text }
            : { ...base, kind: "text", source: attachment.text };
        }
        return { ...base, kind: "metadata" };
      })
      .catch((error: unknown) => {
        this.attachmentCache.delete(key);
        throw error;
      });
    this.attachmentCache.set(key, {
      expiresAt: now + CACHE_TTL_MS,
      value,
    });
    return value;
  }

  async resolveEmbed(
    request: EmbedResolutionRequest,
    currentNotePath?: string,
  ): Promise<ResolvedEmbed> {
    const entries = await this.entries();
    const targetExtension = extension(request.path);
    if (!targetExtension || targetExtension === ".md") {
      try {
        const path = resolveVaultLinkPath({
          targetPath: request.path,
          kind: "note",
          entries,
          currentNotePath,
        });
        return { kind: "note", path };
      } catch (error) {
        if (targetExtension === ".md" || !(error instanceof VaultLinkResolutionError)) {
          throw error;
        }
      }
    }

    const path = resolveVaultLinkPath({
      targetPath: request.path,
      kind: "attachment",
      entries,
      currentNotePath,
    });
    const entry = entries.find(
      (candidate) => candidate.kind === "attachment" && candidate.path === path,
    );
    if (!entry) throw new VaultLinkResolutionError(`Vault 中找不到：${request.path}`);
    return this.resolveAttachment(path, entry.revision);
  }

  async resolveWikiLink(
    request: WikiLinkNavigationRequest,
    currentNotePath?: string,
  ): Promise<string> {
    return resolveVaultLinkPath({
      targetPath: request.path,
      kind: "note",
      entries: await this.entries(),
      currentNotePath,
    });
  }

  clear(): void {
    this.entriesCache = null;
    this.attachmentCache.clear();
  }
}

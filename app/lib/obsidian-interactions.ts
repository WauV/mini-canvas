export type EmbedResolutionRequest = {
  target: string;
  path: string;
  subpath: string;
  label: string;
  width?: number;
  height?: number;
};

export type WikiLinkNavigationRequest = {
  target: string;
  path: string;
  subpath: string;
  label: string;
};

type ResolvedEmbedBase = {
  path: string;
  mimeType: string;
  revision: string;
  size: number;
};

export type ResolvedEmbed =
  | (ResolvedEmbedBase & { kind: "image"; source: string })
  | (ResolvedEmbedBase & { kind: "svg"; source: string })
  | (ResolvedEmbedBase & { kind: "text"; source: string })
  | (ResolvedEmbedBase & { kind: "metadata" })
  | { kind: "note"; path: string };

export type LivePreviewInteractions = {
  resolveEmbed?(request: EmbedResolutionRequest): Promise<ResolvedEmbed>;
  openWikiLink?(request: WikiLinkNavigationRequest): Promise<void> | void;
};

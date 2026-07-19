import type { VaultEntryKind } from "./mcp/mini-canvas-client.ts";

export type ParsedObsidianLink = {
  target: string;
  path: string;
  subpath: string;
  label: string;
  width?: number;
  height?: number;
};

export type VaultLinkEntry = {
  path: string;
  kind: VaultEntryKind;
};

export class VaultLinkResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultLinkResolutionError";
  }
}

function firstUnescapedPipe(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "|") continue;
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return index;
  }
  return -1;
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function parseObsidianLink(
  body: string,
  options: { embed?: boolean } = {},
): ParsedObsidianLink {
  const separator = firstUnescapedPipe(body);
  const target = (separator < 0 ? body : body.slice(0, separator)).trim();
  const alias = separator < 0 ? "" : body.slice(separator + 1).trim();
  const subpathStart = target.indexOf("#");
  const path = (subpathStart < 0 ? target : target.slice(0, subpathStart)).trim();
  const subpath = subpathStart < 0 ? "" : target.slice(subpathStart);
  const dimensions = options.embed ? alias.match(/^(\d+)(?:x(\d+))?$/u) : null;
  const defaultLabel = path ? fileName(path) : target;

  return {
    target,
    path,
    subpath,
    label: alias && !dimensions ? alias.replaceAll("\\|", "|") : defaultLabel,
    ...(dimensions ? { width: Number(dimensions[1]) } : {}),
    ...(dimensions?.[2] ? { height: Number(dimensions[2]) } : {}),
  };
}

function normalizeForComparison(path: string): string {
  return path.normalize("NFKC").toLocaleLowerCase("en-US");
}

function normalizeVaultRelative(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new VaultLinkResolutionError("链接路径超出了 Vault 根目录");
      }
      segments.pop();
      continue;
    }
    if (segment.includes("\0")) {
      throw new VaultLinkResolutionError("链接路径包含无效字符");
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function notePath(path: string): string {
  return path.toLocaleLowerCase("en-US").endsWith(".md") ? path : `${path}.md`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function resolveVaultLinkPath(input: {
  targetPath: string;
  kind: VaultEntryKind;
  entries: VaultLinkEntry[];
  currentNotePath?: string;
}): string {
  const rawTarget = input.targetPath.trim().replaceAll("\\", "/");
  if (!rawTarget && input.kind === "note" && input.currentNotePath) {
    return normalizeVaultRelative(input.currentNotePath);
  }
  if (!rawTarget) throw new VaultLinkResolutionError("Wiki Link 没有文件路径");

  const rooted = rawTarget.startsWith("/");
  const explicitlyRelative = rawTarget.startsWith("./") || rawTarget.startsWith("../");
  const target = rawTarget.replace(/^\/+/, "");
  const currentDirectory = input.currentNotePath
    ? normalizeVaultRelative(input.currentNotePath).split("/").slice(0, -1).join("/")
    : "";
  const asKind = (path: string) =>
    input.kind === "note" ? notePath(path) : path;
  const rootCandidate = explicitlyRelative
    ? null
    : asKind(normalizeVaultRelative(target));
  const relativeCandidate = asKind(
    normalizeVaultRelative(currentDirectory ? `${currentDirectory}/${rawTarget}` : rawTarget),
  );
  const requestedCandidates = rooted
    ? [rootCandidate!]
    : explicitlyRelative
      ? [relativeCandidate]
      : target.includes("/")
        ? [rootCandidate!, relativeCandidate]
        : [relativeCandidate, rootCandidate!];
  const candidates = unique(requestedCandidates);
  const entries = input.entries.filter((entry) => entry.kind === input.kind);

  for (const candidate of candidates) {
    const exact = entries.find((entry) => entry.path === candidate);
    if (exact) return exact.path;
  }
  for (const candidate of candidates) {
    const comparable = normalizeForComparison(candidate);
    const matches = entries.filter(
      (entry) => normalizeForComparison(entry.path) === comparable,
    );
    if (matches.length === 1) return matches[0].path;
    if (matches.length > 1) {
      throw new VaultLinkResolutionError(`链接目标不唯一：${input.targetPath}`);
    }
  }

  if (!rootCandidate) {
    throw new VaultLinkResolutionError(`Vault 中找不到：${input.targetPath}`);
  }
  const suffix = normalizeForComparison(rootCandidate);
  const suffixMatches = entries.filter((entry) => {
    const comparable = normalizeForComparison(entry.path);
    return comparable === suffix || comparable.endsWith(`/${suffix}`);
  });
  if (suffixMatches.length === 1) return suffixMatches[0].path;
  if (suffixMatches.length > 1) {
    throw new VaultLinkResolutionError(`找到多个同名目标：${input.targetPath}`);
  }
  throw new VaultLinkResolutionError(`Vault 中找不到：${input.targetPath}`);
}

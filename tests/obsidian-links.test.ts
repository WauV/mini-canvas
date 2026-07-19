import assert from "node:assert/strict";
import { test } from "vitest";

import {
  parseObsidianLink,
  resolveVaultLinkPath,
  VaultLinkResolutionError,
  type VaultLinkEntry,
} from "../app/lib/obsidian-links.ts";

test("parses Wiki aliases, heading targets and embed dimensions", () => {
  assert.deepEqual(parseObsidianLink("Notes/Page#章节|显示名称"), {
    target: "Notes/Page#章节",
    path: "Notes/Page",
    subpath: "#章节",
    label: "显示名称",
  });
  assert.deepEqual(parseObsidianLink("Assets/图.png|320x180", { embed: true }), {
    target: "Assets/图.png",
    path: "Assets/图.png",
    subpath: "",
    label: "图.png",
    width: 320,
    height: 180,
  });
  assert.equal(parseObsidianLink("Page|带\\|竖线").label, "带|竖线");
  assert.equal(parseObsidianLink("#本页标题").path, "");
});

const ENTRIES: VaultLinkEntry[] = [
  { path: "Notes/Current.md", kind: "note" },
  { path: "Notes/Target.md", kind: "note" },
  { path: "Archive/Case.md", kind: "note" },
  { path: "Notes/Upper.MD", kind: "note" },
  { path: "Assets/Figure.png", kind: "attachment" },
  { path: "Other/Figure.png", kind: "attachment" },
  { path: "Graphics/Unique.svg", kind: "attachment" },
];

test("resolves current-directory, root, relative and unique-short Vault links", () => {
  assert.equal(
    resolveVaultLinkPath({
      targetPath: "Target",
      kind: "note",
      entries: ENTRIES,
      currentNotePath: "Notes/Current.md",
    }),
    "Notes/Target.md",
  );
  assert.equal(
    resolveVaultLinkPath({
      targetPath: "Assets/Figure.png",
      kind: "attachment",
      entries: ENTRIES,
      currentNotePath: "Notes/Current.md",
    }),
    "Assets/Figure.png",
  );
  assert.equal(
    resolveVaultLinkPath({
      targetPath: "../Target",
      kind: "note",
      entries: ENTRIES,
      currentNotePath: "Notes/Sub/Current.md",
    }),
    "Notes/Target.md",
  );
  assert.equal(
    resolveVaultLinkPath({
      targetPath: "unique.svg",
      kind: "attachment",
      entries: ENTRIES,
    }),
    "Graphics/Unique.svg",
  );
  assert.equal(
    resolveVaultLinkPath({
      targetPath: "archive/case",
      kind: "note",
      entries: ENTRIES,
    }),
    "Archive/Case.md",
  );
  assert.equal(
    resolveVaultLinkPath({
      targetPath: "",
      kind: "note",
      entries: ENTRIES,
      currentNotePath: "Notes/Current.md",
    }),
    "Notes/Current.md",
  );
  assert.equal(
    resolveVaultLinkPath({
      targetPath: "Upper.MD",
      kind: "note",
      entries: ENTRIES,
      currentNotePath: "Notes/Current.md",
    }),
    "Notes/Upper.MD",
  );
});

test("rejects ambiguous, missing and escaping Vault paths", () => {
  assert.throws(
    () =>
      resolveVaultLinkPath({
        targetPath: "Figure.png",
        kind: "attachment",
        entries: ENTRIES,
      }),
    /多个同名目标/u,
  );
  assert.throws(
    () =>
      resolveVaultLinkPath({
        targetPath: "Missing",
        kind: "note",
        entries: ENTRIES,
      }),
    VaultLinkResolutionError,
  );
  assert.throws(
    () =>
      resolveVaultLinkPath({
        targetPath: "../../../secret.png",
        kind: "attachment",
        entries: ENTRIES,
        currentNotePath: "Notes/Current.md",
      }),
    /超出了 Vault 根目录/u,
  );
});

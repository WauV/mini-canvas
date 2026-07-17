import assert from "node:assert/strict";
import test from "node:test";

import { liveSyncPathToDocumentId } from "../src/bridge.ts";

test("escapes CouchDB-reserved path prefixes as ordinary LiveSync IDs", () => {
  const id = liveSyncPathToDocumentId("_design/views/note.md", true);

  assert.equal(id, "/_design/views/note.md");
  assert.equal(
    encodeURIComponent(id),
    "%2F_design%2Fviews%2Fnote.md",
  );
});

test("normalizes Windows-style paths and case when configured", () => {
  assert.equal(
    liveSyncPathToDocumentId("Folder\\Note.md", true),
    "folder/note.md",
  );
});

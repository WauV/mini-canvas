"use client";

import { useCallback, type Dispatch } from "react";
import type { DocumentPersistenceAction } from "./document-persistence-state";
import type { DocumentPersistenceRuntime } from "./document-persistence-runtime";
import type { EnqueueSave } from "./use-document-autosave";
import { DEFAULT_DOCUMENT_ID } from "./types";

export type ConflictResolution = "overwrite" | "reload";

export function useDocumentConflictResolution(options: {
  runtime: DocumentPersistenceRuntime;
  dispatch: Dispatch<DocumentPersistenceAction>;
  enqueueSave: EnqueueSave;
}): (strategy: ConflictResolution, confirmation: string) => void {
  const { runtime, dispatch, enqueueSave } = options;

  return useCallback(
    (strategy: ConflictResolution, confirmation: string): void => {
      const repository = runtime.repository();
      if (
        !repository ||
        !runtime.unresolvedConflict() ||
        runtime.resolutionInProgress() ||
        !window.confirm(confirmation) ||
        !runtime.beginResolution()
      ) {
        return;
      }

      dispatch({ type: "resolution-started" });
      void (async () => {
        try {
          const latest = await repository.load(DEFAULT_DOCUMENT_ID);
          if (!latest) throw new Error("找不到已保存版本。");

          if (strategy === "overwrite") {
            const pending = runtime.rebaseVersion(latest.version);
            dispatch({ type: "conflict-rebased", document: pending });
            await enqueueSave(repository, {
              expectedVersion: latest.version,
              pendingDocument: pending,
              resolveConflict: true,
            });
          } else {
            await repository.backup(runtime.currentDocument());
            runtime.activate(repository, latest, true);
            dispatch({
              type: "document-activated",
              document: latest,
              saveState: "saved",
            });
            dispatch({ type: "recovery-availability", available: true });
          }
        } catch {
          dispatch({ type: "save-failed" });
        } finally {
          runtime.finishResolution();
          dispatch({ type: "resolution-finished" });
        }
      })();
    },
    [dispatch, enqueueSave, runtime],
  );
}

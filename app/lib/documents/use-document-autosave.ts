"use client";

import { useEffect, type Dispatch } from "react";
import type {
  DocumentPersistenceAction,
  DocumentPersistenceState,
} from "./document-persistence-state";
import type {
  DocumentPersistenceRuntime,
  EnqueueSaveOptions,
  SaveOutcome,
} from "./document-persistence-runtime";
import type { DocumentRepository } from "./types";

export type EnqueueSave = (
  repository: DocumentRepository,
  options?: EnqueueSaveOptions,
) => Promise<SaveOutcome>;

export function useDocumentAutosave(options: {
  state: DocumentPersistenceState;
  runtime: DocumentPersistenceRuntime;
  dispatch: Dispatch<DocumentPersistenceAction>;
  enqueueSave: EnqueueSave;
}): void {
  const { state, runtime, dispatch, enqueueSave } = options;

  useEffect(() => {
    if (!state.ready || state.saveConflict) return;
    const repository = runtime.repository();
    if (!repository) return;

    if (runtime.isCurrentPersisted()) {
      dispatch({ type: "save-unchanged" });
      return;
    }

    const timer = window.setTimeout(() => {
      void enqueueSave(repository);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [
    dispatch,
    enqueueSave,
    runtime,
    state.document.content,
    state.document.title,
    state.ready,
    state.saveConflict,
  ]);
}

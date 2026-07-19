"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import { INITIAL_DOCUMENT, WIDGET_INITIAL_DOCUMENT } from "../example-markdown";
import {
  documentPersistenceReducer,
  type DocumentPersistenceState,
} from "./document-persistence-state";
import {
  type ActivateDocumentOptions,
  DocumentPersistenceRuntime,
  type EnqueueSaveOptions,
  type SaveOutcome,
} from "./document-persistence-runtime";
import { useDocumentAutosave } from "./use-document-autosave";
import { useDocumentBootstrap } from "./use-document-bootstrap";
import {
  type ConflictResolution,
  useDocumentConflictResolution,
} from "./use-document-conflict-resolution";
import type { LocalStorageDocumentRepository } from "./local-storage-repository";
import type { DocumentRepository, DocumentSnapshot } from "./types";

type DocumentUpdate = Partial<Pick<DocumentSnapshot, "title" | "content">>;

export type DocumentPersistenceActions = {
  currentDocument(): DocumentSnapshot;
  localRepository(): LocalStorageDocumentRepository | null;
  hasConflict(): boolean;
  activate(
    repository: DocumentRepository,
    document: DocumentSnapshot,
    options: ActivateDocumentOptions,
  ): void;
  update(update: DocumentUpdate): void;
  acceptVersion(version: string, updatedAt: number): void;
  enqueueSave(
    repository: DocumentRepository,
    options?: EnqueueSaveOptions,
  ): Promise<void>;
  setRecoveryAvailable(available: boolean): void;
  reportError(): void;
  resolveConflict(strategy: ConflictResolution, confirmation: string): void;
};

export type DocumentPersistenceController = {
  state: DocumentPersistenceState;
  actions: DocumentPersistenceActions;
};

export function useDocumentPersistence(
  isWidget: boolean,
): DocumentPersistenceController {
  const initialDocument = isWidget ? WIDGET_INITIAL_DOCUMENT : INITIAL_DOCUMENT;
  const [state, dispatch] = useReducer(documentPersistenceReducer, {
    document: initialDocument,
    saveState: "saved",
    saveConflict: null,
    resolvingConflict: false,
    hasRecovery: false,
    ready: isWidget,
  });
  const [runtime] = useState(() => new DocumentPersistenceRuntime(initialDocument));

  const applySaveOutcome = useCallback((outcome: SaveOutcome): void => {
    switch (outcome.kind) {
      case "blocked":
        return;
      case "unchanged":
        dispatch({ type: "save-unchanged" });
        return;
      case "saved":
        dispatch({ type: "save-succeeded", ...outcome });
        return;
      case "conflict":
        dispatch({ type: "save-conflict", conflict: outcome.conflict });
        return;
      case "error":
        dispatch({ type: "save-failed" });
    }
  }, []);

  const enqueueSave = useCallback(
    async (
      repository: DocumentRepository,
      options?: EnqueueSaveOptions,
    ): Promise<void> => {
      applySaveOutcome(await runtime.persist(repository, options));
    },
    [applySaveOutcome, runtime],
  );

  useDocumentBootstrap({ isWidget, runtime, dispatch });
  useDocumentAutosave({ state, runtime, dispatch, enqueueSave });
  const resolveConflict = useDocumentConflictResolution({
    runtime,
    dispatch,
    enqueueSave,
  });

  const actions = useMemo<DocumentPersistenceActions>(
    () => ({
      currentDocument: () => runtime.currentDocument(),
      localRepository: () => runtime.localRepository(),
      hasConflict: () => runtime.unresolvedConflict() !== null,
      activate: (repository, document, options) => {
        runtime.activate(repository, document, options.persisted);
        dispatch({
          type: "document-activated",
          document,
          saveState:
            options.saveState ?? (options.persisted ? "saved" : "saving"),
        });
      },
      update: (update) => {
        dispatch({ type: "document-updated", document: runtime.update(update) });
      },
      acceptVersion: (version, updatedAt) => {
        dispatch({
          type: "version-accepted",
          document: runtime.acceptVersion(version, updatedAt),
        });
      },
      enqueueSave,
      setRecoveryAvailable: (available) => {
        dispatch({ type: "recovery-availability", available });
      },
      reportError: () => dispatch({ type: "save-failed" }),
      resolveConflict,
    }),
    [enqueueSave, resolveConflict, runtime],
  );

  return useMemo(() => ({ state, actions }), [actions, state]);
}

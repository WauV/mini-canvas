"use client";

import { useEffect, type Dispatch } from "react";
import { INITIAL_DOCUMENT, WIDGET_INITIAL_DOCUMENT } from "../example-markdown";
import type { DocumentPersistenceAction } from "./document-persistence-state";
import { DocumentPersistenceRuntime } from "./document-persistence-runtime";
import { LocalStorageDocumentRepository } from "./local-storage-repository";
import { DEFAULT_DOCUMENT_ID } from "./types";

export function useDocumentBootstrap(options: {
  isWidget: boolean;
  runtime: DocumentPersistenceRuntime;
  dispatch: Dispatch<DocumentPersistenceAction>;
}): void {
  const { isWidget, runtime, dispatch } = options;

  useEffect(() => {
    let active = true;

    if (isWidget) {
      runtime.activate(null, WIDGET_INITIAL_DOCUMENT, true);
      dispatch({
        type: "initialized",
        document: WIDGET_INITIAL_DOCUMENT,
        hasRecovery: false,
      });
      return () => {
        active = false;
      };
    }

    const repository = new LocalStorageDocumentRepository(window.localStorage);
    runtime.setLocalRepository(repository);

    void Promise.all([
      repository.load(DEFAULT_DOCUMENT_ID),
      repository.loadRecovery(),
    ])
      .then(([storedDocument, recovery]) => {
        if (!active) return;
        const initialDocument = storedDocument ?? INITIAL_DOCUMENT;
        runtime.activate(repository, initialDocument, storedDocument !== null);
        dispatch({
          type: "initialized",
          document: initialDocument,
          hasRecovery: recovery !== null,
        });
      })
      .catch(() => {
        if (!active) return;
        dispatch({ type: "initialization-failed" });
      });

    return () => {
      active = false;
    };
  }, [dispatch, isWidget, runtime]);
}

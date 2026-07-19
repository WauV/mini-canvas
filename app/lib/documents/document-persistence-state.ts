import type { DocumentSnapshot } from "./types";

export type SaveState = "saved" | "saving" | "error" | "conflict";

export type SaveConflict = {
  expectedVersion: string;
  actualVersion: string;
};

export type DocumentPersistenceState = {
  document: DocumentSnapshot;
  saveState: SaveState;
  saveConflict: SaveConflict | null;
  resolvingConflict: boolean;
  hasRecovery: boolean;
  ready: boolean;
};

export type DocumentPersistenceAction =
  | {
      type: "initialized";
      document: DocumentSnapshot;
      hasRecovery: boolean;
    }
  | { type: "initialization-failed" }
  | {
      type: "document-activated";
      document: DocumentSnapshot;
      saveState: SaveState;
    }
  | { type: "document-updated"; document: DocumentSnapshot }
  | { type: "version-accepted"; document: DocumentSnapshot }
  | { type: "save-unchanged" }
  | {
      type: "save-succeeded";
      version: string;
      updatedAt: number;
      settled: boolean;
    }
  | { type: "save-conflict"; conflict: SaveConflict }
  | { type: "save-failed" }
  | { type: "recovery-availability"; available: boolean }
  | { type: "resolution-started" }
  | { type: "resolution-finished" }
  | { type: "conflict-rebased"; document: DocumentSnapshot };

export function documentPersistenceReducer(
  state: DocumentPersistenceState,
  action: DocumentPersistenceAction,
): DocumentPersistenceState {
  switch (action.type) {
    case "initialized":
      return {
        ...state,
        document: action.document,
        hasRecovery: action.hasRecovery,
        ready: true,
      };
    case "initialization-failed":
      return { ...state, saveState: "error", ready: true };
    case "document-activated":
      return {
        ...state,
        document: action.document,
        saveState: action.saveState,
        saveConflict: null,
      };
    case "document-updated":
      return {
        ...state,
        document: action.document,
        saveState: state.saveConflict ? "conflict" : "saving",
      };
    case "version-accepted":
      return {
        ...state,
        document: action.document,
        saveState: "saved",
        saveConflict: null,
      };
    case "save-unchanged":
      return { ...state, saveState: "saved" };
    case "save-succeeded":
      return {
        ...state,
        document: {
          ...state.document,
          version: action.version,
          updatedAt: action.updatedAt,
        },
        saveState: action.settled ? "saved" : "saving",
        saveConflict: null,
      };
    case "save-conflict":
      return {
        ...state,
        saveState: "conflict",
        saveConflict: action.conflict,
      };
    case "save-failed":
      return { ...state, saveState: "error" };
    case "recovery-availability":
      return { ...state, hasRecovery: action.available };
    case "resolution-started":
      return { ...state, resolvingConflict: true };
    case "resolution-finished":
      return { ...state, resolvingConflict: false };
    case "conflict-rebased":
      return { ...state, document: action.document, saveState: "saving" };
  }
}

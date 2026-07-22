"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpNoticeValue } from "../../components/canvas/types";
import { hasMeaningfulContent } from "../documents/document-helpers";
import {
  MemoryDocumentRecoveryStore,
  McpDraftDocumentRepository,
  titleFromVaultPath,
} from "../documents/mcp-draft-repository";
import { createIdempotencyKey, type DocumentSnapshot } from "../documents/types";
import type { DocumentPersistenceActions } from "../documents/use-document-persistence";
import type { LivePreviewInteractions } from "../obsidian-interactions";
import {
  type CommitPreview,
  type DraftSnapshot,
  McpRevisionConflictError,
  MiniCanvasMcpClient,
  type VaultNoteEntry,
} from "./mini-canvas-client";
import { LazyMcpToolClient } from "./tool-client";
import { useWidgetHost } from "./use-widget-host";
import { VaultInteractionResolver } from "./vault-interaction-resolver";

type UseMcpDraftSessionOptions = {
  isWidget: boolean;
  documents: DocumentPersistenceActions;
  onStartEditing(): void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "MCP 草稿操作失败";
}

export function useMcpDraftSession({
  isWidget,
  documents,
  onStartEditing,
}: UseMcpDraftSessionOptions) {
  const {
    acceptVersion,
    activate,
    enqueueSave,
    currentDocument,
    localRepository,
    hasConflict,
    setRecoveryAvailable,
  } = documents;
  const [draft, setDraft] = useState<DraftSnapshot | null>(null);
  const [vaultNotes, setVaultNotes] = useState<VaultNoteEntry[]>([]);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [noteQuery, setNoteQuery] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<McpNoticeValue | null>(null);
  const [commitPreview, setCommitPreview] = useState<CommitPreview | null>(null);
  const repositoryRef = useRef<McpDraftDocumentRepository | null>(null);
  const [widgetRecovery] = useState(() => new MemoryDocumentRecoveryStore());
  const [client] = useState(
    () => new MiniCanvasMcpClient(new LazyMcpToolClient()),
  );
  const getClient = useCallback((): MiniCanvasMcpClient => client, [client]);
  const [interactionResolver] = useState(
    () => new VaultInteractionResolver(getClient),
  );

  useEffect(
    () => () => {
      interactionResolver.clear();
      client.close();
    },
    [client, interactionResolver],
  );

  const filteredVaultNotes = useMemo(() => {
    const query = noteQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return vaultNotes;
    return vaultNotes.filter((entry) =>
      entry.path.toLocaleLowerCase("zh-CN").includes(query),
    );
  }, [noteQuery, vaultNotes]);

  const activateDraft = useCallback(
    (
      nextDraft: DraftSnapshot,
      message = nextDraft.isNew
        ? `已打开新笔记草稿 · ${nextDraft.path}`
        : `已打开加密草稿 · ${nextDraft.path}`,
    ): void => {
      const client = getClient();
      const repository = new McpDraftDocumentRepository({
        client,
        draft: nextDraft,
        recovery: localRepository() ?? widgetRecovery,
        onDraftChange: setDraft,
      });
      const nextDocument: DocumentSnapshot = {
        id: nextDraft.id,
        title: titleFromVaultPath(nextDraft.path),
        content: nextDraft.content,
        version: String(nextDraft.version),
        updatedAt: nextDraft.updatedAt,
      };

      repositoryRef.current = repository;
      activate(repository, nextDocument, { persisted: true });
      setDraft(nextDraft);
      setCommitPreview(null);
      onStartEditing();
      setNotePickerOpen(false);
      setNotice({ kind: "success", text: message });
    },
    [activate, getClient, localRepository, onStartEditing, widgetRecovery],
  );

  const showNotePicker = useCallback(() => {
    setNotePickerOpen(true);
    setNotice(null);
    if (notesLoaded || busy) return;

    setBusy(true);
    void getClient()
      .listNotes()
      .then((entries) => {
        setVaultNotes(entries);
        setNotesLoaded(true);
      })
      .catch((error: unknown) => {
        setNotice({ kind: "error", text: errorMessage(error) });
      })
      .finally(() => setBusy(false));
  }, [busy, getClient, notesLoaded]);

  const openVaultNote = useCallback(
    async (
      path: string,
      options: { skipConfirmation?: boolean } = {},
    ): Promise<void> => {
      if (busy) return;
      const current = currentDocument();
      if (
        !options.skipConfirmation &&
        hasMeaningfulContent(current) &&
        !window.confirm(
          "打开 Obsidian 笔记会切换当前编辑器。当前本地内容会进入恢复槽，MCP 草稿会先保存，是否继续？",
        )
      ) {
        return;
      }

      setBusy(true);
      setNotice({ kind: "info", text: "正在创建加密草稿…" });
      try {
        const currentRepository = repositoryRef.current;
        if (currentRepository) {
          const outcome = await enqueueSave(currentRepository);
          if (outcome.kind === "error") {
            throw new Error("当前草稿保存失败，未切换笔记；请检查连接后重试");
          }
          if (
            outcome.kind === "conflict" ||
            outcome.kind === "blocked" ||
            (outcome.kind === "saved" && !outcome.settled) ||
            hasConflict()
          ) {
            throw new Error("当前草稿尚未安全保存，请先解决保存状态再切换");
          }
        } else if (hasMeaningfulContent(current)) {
          await localRepository()?.backup(current);
          setRecoveryAvailable(true);
        }

        const nextDraft = await getClient().createDraft(path);
        activateDraft(nextDraft);
      } catch (error) {
        setNotice({ kind: "error", text: errorMessage(error) });
      } finally {
        setBusy(false);
      }
    },
    [
      activateDraft,
      busy,
      enqueueSave,
      getClient,
      currentDocument,
      localRepository,
      hasConflict,
      setRecoveryAvailable,
    ],
  );

  const currentDraftPath = draft?.path;
  const resolveEmbed = useCallback<
    NonNullable<LivePreviewInteractions["resolveEmbed"]>
  >(
    (request) => interactionResolver.resolveEmbed(request, currentDraftPath),
    [currentDraftPath, interactionResolver],
  );
  const navigateWikiLink = useCallback<
    NonNullable<LivePreviewInteractions["openWikiLink"]>
  >(
    async (request) => {
      try {
        const path = await interactionResolver.resolveWikiLink(
          request,
          currentDraftPath,
        );
        if (currentDraftPath === path) {
          setNotice({
            kind: "info",
            text: request.subpath
              ? `当前已打开该笔记；标题定位 ${request.subpath} 将在后续版本补齐`
              : "当前已经是这篇笔记",
          });
          return;
        }
        await openVaultNote(path);
      } catch (error) {
        setNotice({ kind: "error", text: errorMessage(error) });
        throw error;
      }
    },
    [currentDraftPath, interactionResolver, openVaultNote],
  );
  const livePreviewInteractions = useMemo<LivePreviewInteractions>(
    () => ({ resolveEmbed, openWikiLink: navigateWikiLink }),
    [navigateWikiLink, resolveEmbed],
  );

  const { requestFullscreen } = useWidgetHost({
    enabled: isWidget,
    busy,
    getClient,
    onOpenPicker: showNotePicker,
    onActivateDraft: activateDraft,
    onBusyChange: setBusy,
    onNotice: setNotice,
  });

  const previewCommit = useCallback(async (): Promise<void> => {
    const repository = repositoryRef.current;
    if (!repository || busy || draft?.status !== "active") return;

    setBusy(true);
    setNotice({ kind: "info", text: "正在保存草稿并生成提交预览…" });
    try {
      const contentAtStart = currentDocument().content;
      const outcome = await enqueueSave(repository);
      if (outcome.kind === "error") {
        throw new Error("草稿保存失败，未生成提交预览；请检查连接后重试");
      }
      if (
        outcome.kind === "conflict" ||
        outcome.kind === "blocked" ||
        (outcome.kind === "saved" && !outcome.settled) ||
        hasConflict()
      ) {
        throw new Error("请先解决草稿保存冲突");
      }
      const savedVersion = currentDocument().version;
      const preview = await repository.previewCommit(savedVersion);
      if (
        currentDocument().content !== contentAtStart ||
        currentDocument().version !== savedVersion ||
        preview.version !== Number(savedVersion)
      ) {
        throw new Error("生成预览期间草稿发生变化，请重新预览后再提交");
      }
      setCommitPreview(preview);
      setNotice({
        kind: preview.changed ? "info" : "success",
        text: preview.changed ? "提交预览已生成" : "当前草稿没有需要提交的变化",
      });
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, currentDocument, draft?.status, enqueueSave, hasConflict]);

  const commitCurrentDraft = useCallback(async (): Promise<void> => {
    const repository = repositoryRef.current;
    if (!repository || !commitPreview || !commitPreview.changed || busy) return;
    if (commitPreview.version !== Number(currentDocument().version)) {
      setCommitPreview(null);
      setNotice({ kind: "error", text: "草稿已经变化，请重新生成提交预览" });
      return;
    }

    setBusy(true);
    setNotice({ kind: "info", text: "正在安全提交到 Obsidian…" });
    try {
      const result = await repository.commit(
        currentDocument().version,
        createIdempotencyKey(),
        commitPreview.confirmationToken,
      );
      acceptVersion(String(result.draft.version), result.draft.updatedAt);
      setDraft(result.draft);
      setCommitPreview(null);
      setNotice({
        kind: "success",
        text: `已提交到 Obsidian · revision ${result.note.revision}`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof McpRevisionConflictError
            ? "Obsidian 笔记已经变化；草稿仍然安全保留，未覆盖新内容"
            : errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  }, [acceptVersion, busy, commitPreview, currentDocument]);

  const prepareToLeave = useCallback(async (): Promise<boolean> => {
    const repository = repositoryRef.current;
    if (!repository) return true;
    const outcome = await enqueueSave(repository);
    if (
      (outcome.kind === "unchanged" ||
        (outcome.kind === "saved" && outcome.settled)) &&
      !hasConflict()
    ) {
      return true;
    }
    setNotice({
      kind: "error",
      text:
        outcome.kind === "error"
          ? "当前草稿保存失败，已停止切换；请检查连接后重试"
          : "请先解决当前草稿的保存状态再切换",
    });
    return false;
  }, [enqueueSave, hasConflict]);

  const resetSession = useCallback((options: { clearNotice?: boolean } = {}) => {
    repositoryRef.current = null;
    setDraft(null);
    setCommitPreview(null);
    if (options.clearNotice) setNotice(null);
  }, []);

  return {
    draft,
    busy,
    notice,
    setNotice,
    commitPreview,
    setCommitPreview,
    notePickerOpen,
    setNotePickerOpen,
    noteQuery,
    setNoteQuery,
    notesLoaded,
    filteredVaultNotes,
    livePreviewInteractions,
    showNotePicker,
    openVaultNote,
    previewCommit,
    commitCurrentDraft,
    requestFullscreen,
    prepareToLeave,
    resetSession,
  };
}

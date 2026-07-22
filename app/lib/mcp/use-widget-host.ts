"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  parseDraftSnapshot,
  type DraftSnapshot,
  type MiniCanvasMcpClient,
} from "./mini-canvas-client";
import type { McpToolResult } from "./tool-client";
import type { McpNoticeValue } from "../../components/canvas/types";

export type WidgetLaunch =
  | { mode: "picker" }
  | { mode: "draft"; draftId: string; draft?: DraftSnapshot };

function resultText(result: McpToolResult): string | null {
  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") return item.text;
  }
  return null;
}

export function parseWidgetLaunch(result: McpToolResult): WidgetLaunch {
  if (result.isError) {
    throw new Error(resultText(result) ?? "Mini Canvas 启动工具执行失败");
  }
  const value = result.structuredContent;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Widget 启动数据格式无效");
  }
  const launch = value as Record<string, unknown>;
  if (launch.mode === "picker") return { mode: "picker" };
  if (launch.mode === "draft" && typeof launch.draftId === "string") {
    const metadata = result._meta;
    return {
      mode: "draft",
      draftId: launch.draftId,
      ...(metadata?.draft === undefined
        ? {}
        : { draft: parseDraftSnapshot(metadata.draft) }),
    };
  }
  throw new Error("Widget 没有收到可打开的草稿");
}

type UseWidgetHostOptions = {
  enabled: boolean;
  busy: boolean;
  getClient(): MiniCanvasMcpClient;
  onOpenPicker(): void;
  onActivateDraft(draft: DraftSnapshot): void;
  onBusyChange(busy: boolean): void;
  onNotice(notice: McpNoticeValue): void;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : "MCP 草稿操作失败";
}

export function useWidgetHost({
  enabled,
  busy,
  getClient,
  onOpenPicker,
  onActivateDraft,
  onBusyChange,
  onNotice,
}: UseWidgetHostOptions): { requestFullscreen(): void } {
  const handledLaunchRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const client = getClient();
    return client.subscribeToolResults((result) => {
      if (handledLaunchRef.current) return;
      handledLaunchRef.current = true;

      let launch: WidgetLaunch;
      try {
        launch = parseWidgetLaunch(result);
      } catch (error) {
        onNotice({ kind: "error", text: message(error) });
        return;
      }
      if (launch.mode === "picker") {
        onOpenPicker();
        return;
      }

      if (launch.draft) {
        onActivateDraft(launch.draft);
        return;
      }

      onBusyChange(true);
      onNotice({ kind: "info", text: "正在载入加密草稿…" });
      void client
        .getDraft(launch.draftId)
        .then(onActivateDraft)
        .catch((error: unknown) => {
          onNotice({ kind: "error", text: message(error) });
        })
        .finally(() => onBusyChange(false));
    });
  }, [
    enabled,
    getClient,
    onActivateDraft,
    onBusyChange,
    onNotice,
    onOpenPicker,
  ]);

  const requestFullscreen = useCallback(() => {
    if (!enabled || busy) return;
    onBusyChange(true);
    void getClient()
      .requestDisplayMode("fullscreen")
      .then((mode) => {
        onNotice({
          kind: mode === "fullscreen" ? "success" : "info",
          text:
            mode === "fullscreen"
              ? "已切换为全屏编辑"
              : `宿主使用了 ${mode} 展示模式`,
        });
      })
      .catch((error: unknown) => {
        onNotice({ kind: "error", text: message(error) });
      })
      .finally(() => onBusyChange(false));
  }, [busy, enabled, getClient, onBusyChange, onNotice]);

  return { requestFullscreen };
}

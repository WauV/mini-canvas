import { extname } from "node:path";

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { BridgeRevisionConflictError } from "./bridge-client.ts";
import { AuthorizationError, AuthenticationError } from "./auth.ts";
import {
  DraftConflictError,
  DraftNotFoundError,
  DraftStateError,
} from "./drafts.ts";
import { MiniCanvasService, SearchNotReadyError } from "./service.ts";
import type { Principal } from "./types.ts";
import {
  MINI_CANVAS_WIDGET_URI,
  registerMiniCanvasWidget,
} from "./widget.ts";

const draftOutputSchema = {
  id: z.string(),
  userId: z.string(),
  path: z.string(),
  content: z.string(),
  baseRevision: z.string(),
  version: z.number().int(),
  status: z.enum(["active", "committed", "expired"]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  expiresAt: z.number().int(),
  committedRevision: z.string().optional(),
};

const entrySchema = z.object({
  path: z.string(),
  kind: z.enum(["note", "attachment"]),
  mimeType: z.string(),
  revision: z.string(),
  ctime: z.number(),
  mtime: z.number(),
  size: z.number(),
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
};

const localWriteAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
  destructiveHint: false,
};

// ChatGPT reaches this personal test-Vault server through a bound Secure MCP
// Tunnel. The Tunnel authenticates to the local MCP with a private static
// Bearer token, while the public App surface itself intentionally uses no OAuth.
const noAuthSecuritySchemes = [{ type: "noauth" as const }];
const noAuthToolMeta = { securitySchemes: noAuthSecuritySchemes };

function publicError(error: unknown): string {
  if (
    error instanceof AuthenticationError ||
    error instanceof AuthorizationError ||
    error instanceof DraftNotFoundError ||
    error instanceof DraftStateError ||
    error instanceof SearchNotReadyError
  ) {
    return error.message;
  }
  if (error instanceof DraftConflictError) {
    return JSON.stringify({
      error: "draft_conflict",
      expectedVersion: error.expectedVersion,
      actualVersion: error.actualVersion,
    });
  }
  if (error instanceof BridgeRevisionConflictError) {
    return JSON.stringify({
      error: "revision_conflict",
      expectedRevision: error.expectedRevision,
      actualRevision: error.actualRevision,
    });
  }
  if (error instanceof Error && /必须|只支持|不存在|尚未|无效|过大/u.test(error.message)) {
    return error.message;
  }
  return "Mini Canvas 服务暂时无法完成请求";
}

async function toolResult<T>(
  callback: () => Promise<T> | T,
  message: (value: T) => string,
) {
  try {
    const structuredContent = await callback();
    return {
      structuredContent,
      content: [{ type: "text" as const, text: message(structuredContent) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: publicError(error) }],
    };
  }
}

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_EXTENSIONS = new Set([
  ".svg",
  ".txt",
  ".tex",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".css",
  ".html",
  ".xml",
  ".py",
  ".ps1",
]);

export function createMiniCanvasMcpServer(
  service: MiniCanvasService,
  principal: Principal,
): McpServer {
  const server = new McpServer(
    { name: "mini-canvas", version: "0.1.0" },
    {
      instructions:
        "Search or fetch a note before creating a draft. Preview every changed draft before commit_draft. Never guess draft versions or revisions; use the values returned by tools.",
    },
  );

  registerMiniCanvasWidget(server);

  registerAppTool(
    server,
    "open_mini_canvas",
    {
      title: "Open Mini Canvas",
      description:
        "Open the Mini Canvas editor. Optionally open an existing authorized Markdown note as an encrypted draft.",
      inputSchema: {
        path: z.string().optional(),
      },
      outputSchema: {
        mode: z.enum(["picker", "draft"]),
        draftId: z.string().optional(),
        path: z.string().optional(),
        title: z.string().optional(),
        version: z.number().int().optional(),
        status: z.enum(["active", "committed", "expired"]).optional(),
        baseRevision: z.string().optional(),
      },
      annotations: localWriteAnnotations,
      _meta: {
        securitySchemes: noAuthSecuritySchemes,
        ui: {
          resourceUri: MINI_CANVAS_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": MINI_CANVAS_WIDGET_URI,
        "openai/toolInvocation/invoking": "正在打开 Mini Canvas…",
        "openai/toolInvocation/invoked": "Mini Canvas 已打开",
      },
    },
    async ({ path }) => {
      try {
        if (!path) {
          return {
            structuredContent: { mode: "picker" as const },
            content: [
              {
                type: "text" as const,
                text: "Mini Canvas 已打开，请在 Widget 中选择一篇 Obsidian 笔记。",
              },
            ],
          };
        }

        const draft = await service.createDraft(principal, { path });
        const structuredContent = {
          mode: "draft" as const,
          draftId: draft.id,
          path: draft.path,
          title: draft.path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? draft.path,
          version: draft.version,
          status: draft.status,
          baseRevision: draft.baseRevision,
        };
        return {
          structuredContent,
          content: [
            {
              type: "text" as const,
              text: `Mini Canvas 已打开加密草稿：${draft.path}（v${draft.version}）。`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: publicError(error) }],
        };
      }
    },
  );

  server.registerTool(
    "list_entries",
    {
      title: "List Vault entries",
      description: "List authorized notes and attachments in the Obsidian test Vault.",
      inputSchema: {
        prefix: z.string().optional(),
        kinds: z.array(z.enum(["note", "attachment"])).optional(),
        extensions: z.array(z.string()).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      outputSchema: {
        entries: z.array(entrySchema),
        nextCursor: z.string().optional(),
        baselineSequence: z.string(),
      },
      annotations: readOnlyAnnotations,
      _meta: noAuthToolMeta,
    },
    async (input) =>
      toolResult(
        () => service.listEntries(principal, input),
        (value) => JSON.stringify(value),
      ),
  );

  server.registerTool(
    "read_attachment",
    {
      title: "Read Vault attachment",
      description:
        "Read an authorized image or UTF-8 text attachment. Other binary files return metadata only.",
      inputSchema: { path: z.string() },
      outputSchema: {
        path: z.string(),
        mimeType: z.string(),
        revision: z.string(),
        size: z.number(),
        delivery: z.enum(["image", "text", "metadata_only"]),
        text: z.string().optional(),
      },
      annotations: readOnlyAnnotations,
      _meta: noAuthToolMeta,
    },
    async ({ path }) => {
      try {
        const attachment = await service.readAttachment(principal, path);
        const baseMimeType = attachment.mimeType.split(";", 1)[0].toLowerCase();
        if (IMAGE_MIME_TYPES.has(baseMimeType)) {
          if (attachment.size > 8 * 1024 * 1024) throw new Error("图片附件过大");
          const structuredContent = {
            path: attachment.path,
            mimeType: baseMimeType,
            revision: attachment.revision,
            size: attachment.size,
            delivery: "image" as const,
          };
          return {
            structuredContent,
            content: [
              {
                type: "image" as const,
                data: Buffer.from(attachment.bytes).toString("base64"),
                mimeType: baseMimeType,
              },
              { type: "text" as const, text: JSON.stringify(structuredContent) },
            ],
          };
        }
        if (TEXT_EXTENSIONS.has(extname(attachment.path).toLowerCase())) {
          if (attachment.size > 2 * 1024 * 1024) throw new Error("文本附件过大");
          const text = new TextDecoder("utf-8", { fatal: true }).decode(attachment.bytes);
          const structuredContent = {
            path: attachment.path,
            mimeType: attachment.mimeType,
            revision: attachment.revision,
            size: attachment.size,
            delivery: "text" as const,
            text,
          };
          return {
            structuredContent,
            content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
          };
        }
        const structuredContent = {
          path: attachment.path,
          mimeType: attachment.mimeType,
          revision: attachment.revision,
          size: attachment.size,
          delivery: "metadata_only" as const,
        };
        return {
          structuredContent,
          content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: publicError(error) }],
        };
      }
    },
  );

  server.registerTool(
    "create_draft",
    {
      title: "Create note draft",
      description: "Create an encrypted draft from an existing authorized Markdown note.",
      inputSchema: {
        path: z.string(),
        expiresInHours: z.number().min(1).max(720).optional(),
      },
      outputSchema: draftOutputSchema,
      annotations: localWriteAnnotations,
      _meta: noAuthToolMeta,
    },
    async (input) =>
      toolResult(
        () => service.createDraft(principal, input),
        (draft) => JSON.stringify(draft),
      ),
  );

  server.registerTool(
    "get_draft",
    {
      title: "Get note draft",
      description: "Read the caller's encrypted draft and current optimistic version.",
      inputSchema: { draftId: z.string().uuid() },
      outputSchema: draftOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: noAuthToolMeta,
    },
    async ({ draftId }) =>
      toolResult(
        () => service.getDraft(principal, draftId),
        (draft) => JSON.stringify(draft),
      ),
  );

  server.registerTool(
    "update_draft",
    {
      title: "Update note draft",
      description: "Replace draft Markdown when expectedVersion still matches.",
      inputSchema: {
        draftId: z.string().uuid(),
        content: z.string(),
        expectedVersion: z.number().int().min(1),
      },
      outputSchema: draftOutputSchema,
      annotations: localWriteAnnotations,
      _meta: noAuthToolMeta,
    },
    async (input) =>
      toolResult(
        () => service.updateDraft(principal, input),
        (draft) => JSON.stringify(draft),
      ),
  );

  server.registerTool(
    "preview_commit",
    {
      title: "Preview draft commit",
      description: "Compute a read-only summary before committing a draft to Obsidian.",
      inputSchema: {
        draftId: z.string().uuid(),
        expectedVersion: z.number().int().min(1),
      },
      outputSchema: {
        draftId: z.string(),
        path: z.string(),
        version: z.number().int(),
        baseRevision: z.string(),
        changed: z.boolean(),
        characterDelta: z.number().int(),
        lineDelta: z.number().int(),
        contentSha256: z.string(),
      },
      annotations: readOnlyAnnotations,
      _meta: noAuthToolMeta,
    },
    async (input) =>
      toolResult(
        () => service.previewCommit(principal, input),
        (preview) => JSON.stringify(preview),
      ),
  );

  server.registerTool(
    "commit_draft",
    {
      title: "Commit draft to Obsidian",
      description:
        "Commit a previewed draft through the LiveSync Bridge using revision and idempotency checks.",
      inputSchema: {
        draftId: z.string().uuid(),
        expectedVersion: z.number().int().min(1),
        idempotencyKey: z.string().min(16),
      },
      outputSchema: {
        draft: z.object(draftOutputSchema),
        note: z.object({
          path: z.string(),
          content: z.string(),
          revision: z.string(),
          ctime: z.number(),
          mtime: z.number(),
          size: z.number(),
          children: z.array(z.string()),
          idempotentReplay: z.boolean(),
        }),
      },
      annotations: localWriteAnnotations,
      _meta: noAuthToolMeta,
    },
    async (input) =>
      toolResult(
        () => service.commitDraft(principal, input),
        (result) => JSON.stringify(result),
      ),
  );

  const searchOutputSchema = {
    results: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.union([z.url(), z.literal("")]),
      }),
    ),
  };
  server.registerTool(
    "search",
    {
      title: "Search Obsidian notes",
      description: "Search authorized Markdown notes in the encrypted local index.",
      inputSchema: { query: z.string() },
      outputSchema: searchOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: noAuthToolMeta,
    },
    async ({ query }) =>
      toolResult(
        async () => ({
          results: (await service.searchNotes(principal, query)).map((result) => ({
            id: result.id,
            title: result.title,
            url: "",
          })),
        }),
        (value) => JSON.stringify(value),
      ),
  );

  const fetchOutputSchema = {
    id: z.string(),
    title: z.string(),
    text: z.string(),
    url: z.union([z.url(), z.literal("")]),
    metadata: z.record(z.string(), z.string()).optional(),
  };
  server.registerTool(
    "fetch",
    {
      title: "Fetch Obsidian note",
      description: "Fetch an authorized Markdown note returned by search.",
      inputSchema: { id: z.string() },
      outputSchema: fetchOutputSchema,
      annotations: readOnlyAnnotations,
      _meta: noAuthToolMeta,
    },
    async ({ id }) =>
      toolResult(
        async () => {
          const note = await service.fetchNote(principal, id);
          return {
            id: note.id,
            title: note.title,
            text: note.content,
            url: "",
            metadata: {
              path: note.path,
              revision: note.revision,
              mtime: String(note.mtime),
            },
          };
        },
        (value) => JSON.stringify(value),
      ),
  );

  server.registerTool(
    "refresh_search_index",
    {
      title: "Refresh search index",
      description: "Refresh the authorized Vault search index from LiveSync metadata.",
      inputSchema: {},
      outputSchema: { ok: z.literal(true) },
      annotations: localWriteAnnotations,
      _meta: noAuthToolMeta,
    },
    async () =>
      toolResult(
        async () => {
          await service.refreshSearch(principal);
          return { ok: true as const };
        },
        (value) => JSON.stringify(value),
      ),
  );

  return server;
}

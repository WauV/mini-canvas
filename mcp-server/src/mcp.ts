import { extname } from "node:path";

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { BridgeRevisionConflictError } from "./bridge-client.ts";
import { AuthorizationError, AuthenticationError } from "./auth.ts";
import {
  MINI_CANVAS_COMMAND_GUIDE,
  MINI_CANVAS_SERVER_INSTRUCTIONS,
} from "./command-guide.ts";
import {
  DraftConflictError,
  DraftNotFoundError,
  DraftStateError,
} from "./drafts.ts";
import {
  CommitPreviewRequiredError,
  MiniCanvasService,
  SearchNotReadyError,
} from "./service.ts";
import type { DraftSnapshot, Principal } from "./types.ts";
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
  isNew: z.boolean(),
  version: z.number().int(),
  status: z.enum(["active", "committed", "expired"]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  expiresAt: z.number().int(),
  committedRevision: z.string().optional(),
};

const draftSummaryOutputSchema = z.object({
  id: z.string().uuid(),
  path: z.string(),
  baseRevision: z.string(),
  isNew: z.boolean(),
  version: z.number().int(),
  status: z.enum(["active", "committed", "expired"]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  expiresAt: z.number().int(),
  committedRevision: z.string().optional(),
});

function draftLaunchContent(draft: DraftSnapshot) {
  return {
    mode: "draft" as const,
    draftId: draft.id,
    path: draft.path,
    title: draft.path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? draft.path,
    version: draft.version,
    status: draft.status,
    baseRevision: draft.baseRevision,
    isNew: draft.isNew,
  };
}

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

const vaultCommitAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
  destructiveHint: true,
  idempotentHint: true,
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
    error instanceof CommitPreviewRequiredError ||
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
  if (
    error instanceof Error &&
    /必须|只支持|不存在|已存在|尚未|无效|过大/u.test(error.message)
  ) {
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
      instructions: MINI_CANVAS_SERVER_INSTRUCTIONS,
    },
  );

  registerMiniCanvasWidget(server);

  server.registerPrompt(
    "mini_canvas_commands",
    {
      title: "Mini Canvas shorthand commands",
      description:
        "Operator-friendly Chinese commands for opening, finding, editing, creating, resuming, previewing and committing Obsidian drafts.",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: MINI_CANVAS_COMMAND_GUIDE,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "mini_canvas_edit_note",
    {
      title: "Edit an Obsidian note with Mini Canvas",
      description:
        "Safe cross-host workflow for editing an existing note through an encrypted draft.",
      argsSchema: {
        path: z.string().describe("Vault-relative path, or a distinctive title to search for."),
        request: z.string().describe("The change the user wants to make."),
      },
    },
    ({ path, request }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Edit the Obsidian note ${JSON.stringify(path)} as follows: ${request}`,
              "Use Mini Canvas tools in this exact order:",
              "1. Use search if the exact Vault-relative path is uncertain.",
              "2. Use fetch to read the complete current Markdown.",
              "3. Produce the complete revised Markdown, preserving unrelated content.",
              "4. Call edit_note_in_mini_canvas with the exact path and complete content.",
              "5. In an MCP Apps host, let the user review the rendered draft. In a text-only host, call get_draft and show a concise summary plus the returned Markdown for review.",
              "6. Do not call commit_draft unless the user explicitly approves the reviewed draft.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "mini_canvas_create_note",
    {
      title: "Create an Obsidian note with Mini Canvas",
      description:
        "Safe cross-host workflow for preparing a new note without immediately writing to the Vault.",
      argsSchema: {
        path: z.string().describe("New Vault-relative .md path."),
        request: z.string().describe("Topic and content requirements for the new note."),
      },
    },
    ({ path, request }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Prepare a new Obsidian note at ${JSON.stringify(path)}: ${request}`,
              "Write the complete Markdown, then call create_note_in_mini_canvas with path and content.",
              "In an MCP Apps host, let the user review the rendered draft. In a text-only host, call get_draft and show a concise summary plus the returned Markdown for review.",
              "Do not call commit_draft unless the user explicitly approves the reviewed draft.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "create_note_in_mini_canvas",
    {
      title: "Create new note in Mini Canvas",
      description:
        "Use this when the user asks to create a NEW Obsidian Markdown note. Both path and complete Markdown content are required. This creates a visible encrypted draft only; it never writes to Obsidian until the user reviews and explicitly commits it.",
      inputSchema: {
        path: z
          .string()
          .describe("New Vault-relative path ending in .md. The note must not already exist."),
        content: z
          .string()
          .describe("Complete initial Markdown content for the new note."),
        expiresInHours: z.number().min(1).max(720).optional(),
      },
      outputSchema: {
        mode: z.literal("draft"),
        draftId: z.string().uuid(),
        path: z.string(),
        title: z.string(),
        version: z.number().int(),
        status: z.enum(["active", "committed", "expired"]),
        baseRevision: z.string(),
        isNew: z.literal(true),
      },
      annotations: localWriteAnnotations,
      _meta: {
        securitySchemes: noAuthSecuritySchemes,
        ui: {
          resourceUri: MINI_CANVAS_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": MINI_CANVAS_WIDGET_URI,
        "openai/toolInvocation/invoking": "正在创建新笔记草稿…",
        "openai/toolInvocation/invoked": "新笔记草稿已在 Mini Canvas 中打开",
      },
    },
    async ({ path, content, expiresInHours }) => {
      try {
        const draft = await service.createDraft(principal, {
          path,
          content,
          expiresInHours,
          createIfMissing: true,
        });
        const structuredContent = {
          mode: "draft" as const,
          draftId: draft.id,
          path: draft.path,
          title: draft.path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? draft.path,
          version: draft.version,
          status: draft.status,
          baseRevision: draft.baseRevision,
          isNew: true as const,
        };
        return {
          structuredContent,
          _meta: { draft },
          content: [
            {
              type: "text" as const,
              text: `已建立新笔记的加密草稿：${draft.path}（v${draft.version}）。支持 MCP Apps 的宿主会显示 Mini Canvas。尚未提交到 Obsidian。`,
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

  registerAppTool(
    server,
    "open_mini_canvas",
    {
      title: "Open Mini Canvas",
      description:
        "Open the Mini Canvas picker or an EXISTING authorized Markdown note. Never use this tool to create a new note; use create_note_in_mini_canvas instead. For changing an existing note, use edit_note_in_mini_canvas.",
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
        isNew: z.boolean().optional(),
        resumed: z.boolean().optional(),
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
                text: "Mini Canvas 选择器已打开。支持 MCP Apps 的宿主会显示交互界面；纯文本宿主请改用 list_entries、search 或 fetch 选择笔记。",
              },
            ],
          };
        }

        const activeDraft = service.findActiveDraftByPath(principal, path);
        const draft =
          activeDraft ??
          (await service.createDraft(principal, {
            path,
          }));
        const structuredContent = {
          ...draftLaunchContent(draft),
          resumed: activeDraft !== null,
        };
        return {
          structuredContent,
          // The full draft is component-only bootstrap data. Keeping it in
          // result metadata lets the Widget render immediately without a
          // second tool call, while keeping note content out of model-visible
          // structuredContent.
          _meta: { draft },
          content: [
            {
              type: "text" as const,
              text: activeDraft
                ? `已恢复活动草稿：${draft.path}（v${draft.version}）。支持 MCP Apps 的宿主会显示 Mini Canvas。`
                : `已建立${draft.isNew ? "新笔记" : "已有笔记"}的加密草稿：${draft.path}（v${draft.version}）。支持 MCP Apps 的宿主会显示 Mini Canvas；纯文本宿主可调用 get_draft 获取正文。尚未提交到 Obsidian。`,
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

  registerAppTool(
    server,
    "open_draft_in_mini_canvas",
    {
      title: "Open existing draft in Mini Canvas",
      description:
        "Reopen the exact encrypted draft identified by draftId in the Mini Canvas Widget. Use list_drafts first when the draftId is unknown. This never creates or commits a note.",
      inputSchema: {
        draftId: z.string().uuid(),
      },
      outputSchema: {
        mode: z.literal("draft"),
        draftId: z.string().uuid(),
        path: z.string(),
        title: z.string(),
        version: z.number().int(),
        status: z.enum(["active", "committed", "expired"]),
        baseRevision: z.string(),
        isNew: z.boolean(),
      },
      annotations: readOnlyAnnotations,
      _meta: {
        securitySchemes: noAuthSecuritySchemes,
        ui: {
          resourceUri: MINI_CANVAS_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": MINI_CANVAS_WIDGET_URI,
        "openai/toolInvocation/invoking": "正在恢复 Mini Canvas 草稿…",
        "openai/toolInvocation/invoked": "Mini Canvas 草稿已恢复",
      },
    },
    async ({ draftId }) => {
      try {
        const draft = service.getDraft(principal, draftId);
        return {
          structuredContent: draftLaunchContent(draft),
          _meta: { draft },
          content: [
            {
              type: "text" as const,
              text: `已重新打开加密草稿：${draft.path}（v${draft.version}，${draft.status}）。尚未执行任何提交。`,
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

  registerAppTool(
    server,
    "edit_note_in_mini_canvas",
    {
      title: "Edit note in Mini Canvas",
      description:
        "Use this when the user asks to edit, rewrite, expand, correct, or fill an existing Obsidian Markdown note. Pass the complete revised Markdown; it opens as a visible encrypted draft and does not change Obsidian until preview and commit.",
      inputSchema: {
        path: z.string().describe("Vault-relative path of an existing .md note."),
        content: z
          .string()
          .describe("Complete revised Markdown content that should appear in the draft."),
        expiresInHours: z.number().min(1).max(720).optional(),
      },
      outputSchema: {
        mode: z.literal("draft"),
        draftId: z.string().uuid(),
        path: z.string(),
        title: z.string(),
        version: z.number().int(),
        status: z.enum(["active", "committed", "expired"]),
        baseRevision: z.string(),
        isNew: z.literal(false),
      },
      annotations: localWriteAnnotations,
      _meta: {
        securitySchemes: noAuthSecuritySchemes,
        ui: {
          resourceUri: MINI_CANVAS_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": MINI_CANVAS_WIDGET_URI,
        "openai/toolInvocation/invoking": "正在把修改写入可见草稿…",
        "openai/toolInvocation/invoked": "修改已在 Mini Canvas 中显示",
      },
    },
    async ({ path, content, expiresInHours }) => {
      try {
        const draft = await service.createDraft(principal, {
          path,
          content,
          expiresInHours,
        });
        const structuredContent = {
          mode: "draft" as const,
          draftId: draft.id,
          path: draft.path,
          title: draft.path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? draft.path,
          version: draft.version,
          status: draft.status,
          baseRevision: draft.baseRevision,
          isNew: false as const,
        };
        return {
          structuredContent,
          _meta: { draft },
          content: [
            {
              type: "text" as const,
              text: `已将完整修改写入加密草稿：${draft.path}（v${draft.version}）。支持 MCP Apps 的宿主会显示 Mini Canvas；纯文本宿主可调用 get_draft 获取正文供用户审阅。尚未提交到 Obsidian。`,
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

  registerAppTool(
    server,
    "create_draft",
    {
      title: "Create note draft",
      description:
        "Low-level tool for opening an EXISTING Markdown note as a visible encrypted draft. To create a new note, always use create_note_in_mini_canvas.",
      inputSchema: {
        path: z.string(),
        expiresInHours: z.number().min(1).max(720).optional(),
      },
      outputSchema: {
        ...draftOutputSchema,
        mode: z.literal("draft"),
        draftId: z.string().uuid(),
      },
      annotations: localWriteAnnotations,
      _meta: {
        ...noAuthToolMeta,
        ui: {
          resourceUri: MINI_CANVAS_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": MINI_CANVAS_WIDGET_URI,
        "openai/toolInvocation/invoking": "正在创建可见草稿…",
        "openai/toolInvocation/invoked": "草稿已在 Mini Canvas 中打开",
      },
    },
    async (input) => {
      try {
        const draft = await service.createDraft(principal, input);
        return {
          structuredContent: {
            ...draft,
            mode: "draft" as const,
            draftId: draft.id,
          },
          _meta: { draft },
          content: [
            {
              type: "text" as const,
              text: `加密草稿已建立：${draft.path}（v${draft.version}）。支持 MCP Apps 的宿主会显示 Mini Canvas；纯文本宿主可调用 get_draft 获取正文。`,
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

  registerAppTool(
    server,
    "list_drafts",
    {
      title: "List encrypted drafts",
      description:
        "List the caller's encrypted draft metadata without exposing draft bodies. Use this to recover a draftId, then call open_draft_in_mini_canvas to render that exact draft.",
      inputSchema: {
        path: z.string().optional(),
        status: z.enum(["active", "committed", "expired"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      outputSchema: {
        drafts: z.array(draftSummaryOutputSchema),
        count: z.number().int(),
      },
      annotations: readOnlyAnnotations,
      _meta: {
        ...noAuthToolMeta,
        ui: { visibility: ["model", "app"] },
      },
    },
    (input) =>
      toolResult(
        () => {
          const drafts = service.listDrafts(principal, input);
          return { drafts, count: drafts.length };
        },
        ({ drafts, count }) =>
          count === 0
            ? "没有找到符合条件的草稿。"
            : `找到 ${count} 个草稿：${drafts
                .map(
                  (draft) =>
                    `${draft.path}（${draft.status}，v${draft.version}，draftId=${draft.id}）`,
                )
                .join("；")}`,
      ),
  );

  registerAppTool(
    server,
    "get_draft",
    {
      title: "Get note draft",
      description: "Read the caller's encrypted draft and current optimistic version.",
      inputSchema: { draftId: z.string().uuid() },
      outputSchema: {
        ...draftOutputSchema,
        mode: z.literal("draft"),
        draftId: z.string().uuid(),
      },
      annotations: readOnlyAnnotations,
      _meta: {
        ...noAuthToolMeta,
        ui: {
          resourceUri: MINI_CANVAS_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": MINI_CANVAS_WIDGET_URI,
      },
    },
    async ({ draftId }) => {
      try {
        const draft = service.getDraft(principal, draftId);
        return {
          structuredContent: {
            ...draft,
            mode: "draft" as const,
            draftId: draft.id,
          },
          _meta: { draft },
          content: [
            {
              type: "text" as const,
              text: `已读取草稿：${draft.path}（v${draft.version}）。正文位于 structuredContent.content；支持 MCP Apps 的宿主也会显示 Mini Canvas。`,
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

  registerAppTool(
    server,
    "update_draft",
    {
      title: "Update note draft",
      description: "Replace draft Markdown when expectedVersion still matches.",
      inputSchema: {
        draftId: z.string().uuid(),
        content: z.string(),
        expectedVersion: z.number().int().min(1),
      },
      outputSchema: {
        ...draftOutputSchema,
        mode: z.literal("draft"),
        draftId: z.string().uuid(),
      },
      annotations: localWriteAnnotations,
      _meta: {
        ...noAuthToolMeta,
        ui: {
          resourceUri: MINI_CANVAS_WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": MINI_CANVAS_WIDGET_URI,
        "openai/toolInvocation/invoking": "正在更新可见草稿…",
        "openai/toolInvocation/invoked": "草稿已在 Mini Canvas 中更新",
      },
    },
    async (input) => {
      try {
        const draft = service.updateDraft(principal, input);
        return {
          structuredContent: {
            ...draft,
            mode: "draft" as const,
            draftId: draft.id,
          },
          _meta: { draft },
          content: [
            {
              type: "text" as const,
              text: `草稿内容已更新：${draft.path}（v${draft.version}）。支持 MCP Apps 的宿主会显示 Mini Canvas；纯文本宿主可再次调用 get_draft 审阅正文。`,
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
        confirmationToken: z.string().min(32),
        baseRevision: z.string(),
        isNew: z.boolean(),
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
        confirmationToken: z.string().min(32),
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
      annotations: vaultCommitAnnotations,
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

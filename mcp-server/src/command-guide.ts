export const MINI_CANVAS_COMMAND_GUIDE = `# Mini Canvas 快捷口令

这些口令是对现有 MCP 工具工作流的自然语言简写，不是操作系统命令。用户可以使用“MC”或“小画布”作为前缀，不必提供完整 Vault 路径。

- MC 帮助
  只列出本口令表，不调用工具。
- MC 打开 <标题或路径>
  路径不明确时先 search；唯一匹配后调用 open_mini_canvas。若该路径已有 active 草稿，服务器会恢复它。
- MC 继续 [标题]
  调用 list_drafts({ status: "active" })。优先选择用户指定标题的精确 basename；未指定标题时选择 updatedAt 最新的草稿，然后调用 open_draft_in_mini_canvas。
- MC 查找 <关键词>
  调用 search，只返回简洁候选列表，不创建草稿。
- MC 编辑 <标题>：<修改要求>
  依次执行 search（路径已明确时可省略）→ fetch 完整 Markdown → 生成完整修改稿 → edit_note_in_mini_canvas。只建立或更新可见草稿，不提交。
- MC 新建 <标题>：<内容要求>
  先确认没有同名笔记；生成完整 Markdown，再调用 create_note_in_mini_canvas。用户未指定目录时使用 Vault 根目录的“<标题>.md”。只建立草稿，不提交。
- MC 预览提交 [标题]
  解析当前或指定的 active 草稿，读取最新版本，然后调用 preview_commit。只展示预览，不提交。
- MC 提交 [标题]
  这条明确口令表示用户请求提交已经审阅的草稿。先取得最新草稿版本并生成新的 preview_commit；随后使用其 confirmationToken 和新的 idempotencyKey 调用 commit_draft。仍遵守宿主的写操作确认。
- MC 状态 [标题]
  调用 list_drafts，简要显示 path、status、version 和 updatedAt，不读取正文。

标题解析规则：
1. 用户给出 Vault 相对路径时直接使用。
2. 只有标题时，先 search，并优先选择 basename 去掉 .md 后完全相同的结果。
3. 多个结果同样合理时，只问一个简短澄清问题；不要猜路径。
4. 找不到结果时明确报告；除“MC 新建”外不要自动创建笔记。

草稿解析规则：
1. 优先复用当前对话最近一次工具结果中的 draftId 和 version。
2. 缺少 draftId 时调用 list_drafts；不要声称无法查看草稿，也不要在未调用 list_drafts 时声称没有 active 草稿。
3. 打开、编辑、新建、继续、查找、状态和预览都不得提交。
4. “保存”“完成”“看起来可以”等普通表达不等于提交授权；只有用户明确要求提交，或使用“MC 提交”，才进入提交工作流。
`;

export const MINI_CANVAS_SERVER_INSTRUCTIONS = `Mini Canvas manages an isolated Obsidian Vault through encrypted drafts.

Recognize the Chinese shorthand commands beginning with "MC" or "小画布". Follow the exact routing and safety rules in the built-in mini_canvas_commands prompt. Users may provide a note title instead of a full Vault path: resolve it with search, prefer an exact Markdown basename, and ask one concise clarification only when multiple matches remain.

Core workflows:
- Existing-note edit: search if needed, fetch the complete Markdown, produce a complete revision, then call edit_note_in_mini_canvas.
- New note: call create_note_in_mini_canvas with a .md path and complete Markdown. Never use open_mini_canvas to create a note.
- Resume draft: use the draftId already present in conversation context; otherwise call list_drafts and then open_draft_in_mini_canvas. Never claim that no active draft exists before calling list_drafts.
- MCP Apps hosts render the encrypted draft. Text-only hosts call get_draft and present the Markdown for review.

Never commit during open, search, edit, create, resume, status, or preview operations. Commit only after the user explicitly requests it or writes "MC 提交". Always create a fresh preview_commit for the latest draft version, then pass its confirmationToken with a new idempotencyKey to commit_draft. Preserve expected versions and revisions exactly.`;

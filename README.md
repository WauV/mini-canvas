# Mini Canvas

一个面向 ChatGPT Canvas / MCP Apps 场景的轻量写作实验项目。

当前已经完成前端编辑器 MVP、隔离测试环境中的 LiveSync V2 Bridge、Node.js / TypeScript MCP 草稿、授权、搜索和附件读取层，以及编辑器到 MCP 加密草稿的完整本地接入。下一阶段使用 MCP Inspector 做协议验收，再把同一编辑器核心注册为 ChatGPT Widget。

> 当前状态：新建文档和示例仍使用浏览器 Local Storage；点击“打开笔记”后，编辑器会切换到 MCP Draft Repository，自动保存加密草稿，并在用户确认预览后通过 Bridge 安全提交。所有联调只使用隔离 CouchDB 与测试 Vault，正式 Vault 从未接入测试链路。

## 已实现功能

- CodeMirror 6 单栏 Live Preview
- Live Preview 与 Markdown 源码两种模式
- 原始 Markdown 作为唯一数据源，不经过富文本反向序列化
- 常用 CommonMark / GFM 与 Obsidian 扩展语法的 Live Preview 子集
- Obsidian Wiki Link、Embed、引用、脚注、Callout、高亮、标签、注释、Block ID 与 Frontmatter
- 可交互任务列表和 Markdown 表格
- 行内与块级 LaTeX 公式；点击公式可返回源码编辑
- 内联 `<svg>...</svg>` 与 `svg` 代码围栏的安全图形预览
- 可切换的 Markdown 快捷工具栏：已有格式再次点击即可取消或替换
- 文档标题编辑，以及适合中英文混排的行数、字词、字符统计
- 通过统一 `DocumentRepository` 自动保存浏览器本地文档或 MCP 加密草稿
- 从隔离 Vault 列出并打开 Markdown 笔记，提供草稿版本、提交预览和正式提交
- 草稿乐观锁、串行保存队列、revision 冲突提示和幂等写回
- 新建或加载示例前保留恢复版本，避免误操作直接覆盖草稿
- 文档变化时才重新解析 Markdown；仅移动光标或改变选区时复用解析结果
- 桌面端与移动端响应式布局
- LiveSync V2 `PBKDF2 → HKDF → AES-256-GCM` 数据块加解密
- 与 LiveSync 一致的加密数据块 ID、revision 冲突检测和幂等提交
- 仅监听 `127.0.0.1`、Bearer Token 保护的 Note-level Bridge API

## 快速开始

### 环境要求

- Node.js 22.13 或更高版本
- npm

### 安装与启动

```bash
npm install
npm run dev
```

启动后访问：

<http://localhost:3000>

只运行 `npm run dev` 时可以使用本地文档和完整编辑器。要打开隔离 Vault 中的笔记，还需要先启动测试 CouchDB、Bridge 和 MCP Server，具体顺序见后文“本地 LiveSync 测试环境”和“TypeScript MCP Server”。

## 使用示例

### Markdown

```markdown
# 一级标题

这是一段 **粗体**、*斜体* 和 ~~删除线~~ 文本。

- 普通列表
- [x] 已完成任务
- [ ] 待完成任务

> 这是一段引用。

正文中的脚注引用[^1]，以及^[一条行内脚注]。

[^1]: 这是脚注定义。

> [!note] Callout 标题
> 这是 Callout 正文。
```

### LaTeX

行内公式：

```markdown
质能方程是 $E = mc^2$。
```

块级公式：

```markdown
$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$
```

### SVG

可以直接保留 Obsidian / Markdown 中的内联 SVG：

```markdown
<svg viewBox="0 0 240 80" role="img" aria-label="示意图">
  <rect width="240" height="80" rx="16" fill="#f4e2d6" />
  <text x="120" y="48" text-anchor="middle" fill="#75422f">
    Mini Canvas
  </text>
</svg>
```

也可以使用更适合编辑长图形源码的 `svg` 代码围栏：

````markdown
```svg
<svg viewBox="0 0 120 40">
  <circle cx="20" cy="20" r="14" fill="#d97757" />
  <path d="M44 20 H108" stroke="#75422f" stroke-width="4" />
</svg>
```
````

Live Preview 会把 SVG 作为隔离的图片资源显示，不会用 `innerHTML` 直接执行源码。脚本、事件属性、`foreignObject`、动画元素和外部资源引用会被移除；点击预览可以回到原始 SVG 编辑。TikZ 暂不支持。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| Ctrl / Cmd + B | 粗体 |
| Ctrl / Cmd + I | 斜体 |
| Ctrl / Cmd + K | 插入链接 |
| Tab | 插入缩进 |

其他格式可以通过编辑器上方的工具栏切换，包括标题、引用、列表、任务列表、脚注、Callout、代码、链接和数学公式。标题、引用、列表以及常用行内格式再次点击时会取消或替换已有标记。

## Obsidian Live Preview

Live Preview 只为原始文本添加视觉装饰，不会先转换成富文本文档再重新生成 Markdown。光标进入标题、公式、Wiki Link 等结构时会显示对应源码，也可以随时切换到完整的 Markdown 源码模式。

当前支持的 Obsidian 扩展语法：

- `[[内部链接]]` 与 `[[目标|别名]]`
- `![[笔记或附件]]`
- `>` 普通引用
- `> [!note]` Callout
- `[^1]` 脚注引用与 `[^1]: ...` 脚注定义
- `^[行内脚注]`
- `==高亮==`
- `#标签/子标签`
- `%%注释%%`
- `^block-id`
- YAML Frontmatter
- 行内和块级 LaTeX
- 内联 SVG 与 `svg` 代码围栏

当前网页已经可以通过 MCP Repository 打开和保存笔记，但 Wiki Link 暂时只负责显示，Embed 仍显示为附件占位卡片。后端已经具备附件读取接口，`![[示意图.svg]]` 的就地加载与渲染还没有接入编辑器；当前页面可用的是笔记内直接保存的 SVG 源码。不认识的语法保持源码显示，不会被删除或改写。

这里的解析器是面向编辑体验的渐进式实现，不是完整的 CommonMark / GFM 合规解析器。当前已经处理转义表格分隔符、未闭合代码围栏和同行块级公式等常见边界，但复杂嵌套、任意反引号长度、深层列表与引用等情况仍需要继续补齐。原始 Markdown 始终留在 CodeMirror 文档中，因此未识别语法不会因预览而丢失。

## 项目结构

```text
mini-canvas/
├── app/
│   ├── components/
│   │   └── Editor.tsx
│   ├── lib/
│   │   ├── documents/
│   │   │   ├── local-storage-repository.ts
│   │   │   ├── mcp-draft-repository.ts
│   │   │   ├── save-queue.ts
│   │   │   └── types.ts
│   │   ├── mcp/
│   │   │   ├── mini-canvas-client.ts
│   │   │   └── tool-client.ts
│   │   ├── document-statistics.ts
│   │   ├── editor-actions.ts
│   │   ├── live-preview.ts
│   │   ├── obsidian-markdown.ts
│   │   └── svg-preview.ts
│   ├── api/mcp-tools/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   ├── MiniCanvas.tsx
│   └── page.tsx
├── tests/
│   ├── document-repository.test.ts
│   ├── document-statistics.test.ts
│   ├── editor-actions.test.ts
│   ├── mcp-draft-client.test.ts
│   ├── obsidian-markdown.test.ts
│   └── rendered-html.test.mjs
├── livesync-bridge/
│   ├── src/
│   └── tests/
├── mcp-server/
│   ├── src/
│   └── tests/
├── scripts/
│   ├── benchmark-markdown.ts
│   ├── setup-mcp-env.ps1
│   ├── setup-test-couchdb.ps1
│   ├── stop-test-couchdb.ps1
│   └── verify-test-environment.ps1
├── docker-compose.dev.yml
├── package.json
└── README.md
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 创建生产构建 |
| `npm start` | 启动生产服务器 |
| `npm test` | 执行构建与自动化测试 |
| `npm run lint` | 检查代码规范 |
| `npm run benchmark` | 对 5 千至 10 万字符文档执行解析与编辑压力测试 |
| `npm run bridge:test` | 测试 LiveSync V2 加密和 xxHash64 兼容逻辑 |
| `npm run bridge:serve` | 启动只监听本机的 Node LiveSync Bridge API |
| `npm run mcp:test` | 测试授权、加密草稿、搜索索引和 MCP 工具契约 |
| `npm run mcp:typecheck` | 单独检查 MCP Server TypeScript 类型 |
| `npm run mcp:index -- --rebuild` | 从隔离 Vault 重建加密搜索索引 |
| `npm run mcp:serve` | 启动只监听本机的 Streamable HTTP MCP Server |

## 数据保存说明

编辑器现在有两种明确的数据模式：

- **本地文档**：新建文档和示例由 `LocalStorageDocumentRepository` 保存在当前浏览器；清理站点数据会删除这部分内容。
- **Obsidian 笔记**：点击“打开笔记”后，由 `McpDraftDocumentRepository` 创建并加载服务端加密草稿；后续输入经过 320 ms 节流和串行保存队列写入 SQLite 密文草稿。
- MCP 草稿不会直接覆盖 Obsidian。用户需要先生成提交预览，再点击“正式提交”；提交成功后当前草稿进入只读状态，点击“继续编辑”会从最新 revision 创建新草稿。
- 若 Obsidian 在草稿期间发生修改，提交会明确报告 revision 冲突，草稿继续保留，不会静默覆盖新内容。
- “新建”“示例”“恢复”和切换笔记仍会使用浏览器恢复槽保护当前版本。恢复槽是本机临时保护，不应当作唯一备份。

编辑器组件只依赖统一的 `DocumentRepository` 契约，不直接了解 CouchDB、LiveSync 密钥或数据块格式。本地开发页通过同源的 `/api/mcp-tools` 服务端代理调用 MCP，Bearer Token 只存在于本机服务端运行环境，不会返回浏览器或写入生产前端包；嵌入 ChatGPT 后则由同一个前端客户端改用 MCP Apps Bridge 的 `tools/call`。

## 本地 LiveSync 测试环境

测试环境与正式笔记、正式数据库完全分开：

- 测试 Vault：`.local/obsidian-test-vault`
- CouchDB 地址：`http://127.0.0.1:5984`
- 测试数据库：`mini_canvas_test`
- 独立数据卷：`mini-canvas-couchdb-test-data`
- 本地凭据：`.local/couchdb.env`

`.local/` 已加入 Git 忽略。测试 Vault 是正式 Vault 的一次性副本，原 LiveSync 连接配置已经从副本中移除，正式 Vault 不会被这些脚本写入。CouchDB 端口只绑定到 `127.0.0.1`，匿名请求会返回 `401`。

启动或重复初始化测试 CouchDB：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-test-couchdb.ps1
```

执行完整隔离与健康检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-test-environment.ps1
```

停止测试 CouchDB 但保留数据卷：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-test-couchdb.ps1
```

不要随意执行带 `-v` 的 `docker compose down`，它会删除测试 CouchDB 数据卷。Obsidian 必须把 `.local/obsidian-test-vault` 作为单独 Vault 打开，并使用 `.local/couchdb.env` 中的本地测试账号连接 `mini_canvas_test`。

## Node LiveSync Bridge

Bridge 源码位于 `livesync-bridge/`。它直接兼容当前测试 Vault 使用的 LiveSync V2 格式：元数据保留明文路径，正文按数据块使用 `PBKDF2-SHA256`、`HKDF-SHA256` 和 `AES-256-GCM` 加密，并使用 LiveSync 的加密 `xxHash64` 数据块 ID。

本地配置：

1. 复制 `livesync-bridge.env.example` 为 `.local/livesync-bridge.env`。
2. `LIVESYNC_PASSPHRASE` 必须与隔离测试 Vault 完全一致。
3. `LIVESYNC_BRIDGE_TOKEN` 使用独立的长随机值，不要与 CouchDB 密码或 LiveSync 口令复用。

读取一篇笔记：

```powershell
npm run bridge:read -- "MiniCanvas Bridge Roundtrip.md" --json
```

安全写回一篇笔记：

```powershell
npm run bridge:write -- "MiniCanvas Bridge Roundtrip.md" `
  --input ".local\new-content.md" `
  --expected-revision "3-example" `
  --idempotency-key "one-unique-commit-key"
```

写入必须同时携带：

- `expectedRevision`：只允许覆盖调用方实际读过的版本；过期时明确返回冲突。
- `idempotencyKey`：相同提交重试时不会重复生成一次业务写入；同一个键不能复用于不同内容。

启动供后续 TypeScript MCP Server 调用的 Note-level API：

```powershell
npm run bridge:serve
```

当前接口：

| 方法与路径 | 作用 | 认证 |
| --- | --- | --- |
| `GET /health` | 本机健康检查 | 无 |
| `POST /v1/notes/read` | 按 Vault 相对路径读取并解密笔记 | Bearer Token |
| `POST /v1/notes/commit` | 按 revision 与幂等键加密提交 | Bearer Token |
| `POST /v1/entries/list` | 分页列出笔记与附件元数据 | Bearer Token |
| `POST /v1/changes/poll` | 使用 opaque sequence 长轮询文件级变更 | Bearer Token |
| `POST /v1/attachments/read` | 解密并返回原始附件字节 | Bearer Token |

安全边界：服务地址被代码固定为 `127.0.0.1`，不向局域网暴露；业务接口要求 Bearer Token，也不开放浏览器 CORS。CouchDB 凭据和 LiveSync 口令只保存在已被 Git 忽略的 `.local/` 中，不进入前端包。所有 CouchDB JSON 都按严格 UTF-8 解码，正文写回后还会用元数据中的 UTF-8 字节数再次校验。

### 已验证的双向闭环（隔离环境）

2026-07-17 在 `mini_canvas_test` 中完成：

- Obsidian → CouchDB → Bridge：中文、Emoji、LaTeX 源码和 Wiki Link 原样解密，197 bytes 校验通过。
- Bridge → CouchDB → Obsidian：Obsidian 正确收到 `BRIDGE_TO_OBSIDIAN_V2`，落盘文件与输入文件 SHA-256 完全一致。
- Obsidian → CouchDB → Bridge：在 Obsidian 追加 `OBSIDIAN_TO_BRIDGE_V3` 后，Bridge 从新 revision 正确读回。
- 重复幂等键返回原提交结果；使用过期 revision 写入不同内容会被拒绝，不会静默覆盖。
- 本机 HTTP API 验证为：健康检查 `200`、无认证读取 `401`、带认证读取 `200; charset=utf-8`。

这些结果只证明当前隔离配置的读写兼容性。正式 Vault 在完成备份、权限和恢复演练前仍不应接入。

## TypeScript MCP Server

MCP Server 位于 `mcp-server/`，只连接本机 Bridge，不保存 CouchDB 账号或 LiveSync 口令。它使用 Streamable HTTP，默认监听 `http://127.0.0.1:3220/mcp`。

首次配置：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-mcp-env.ps1
```

脚本会在 `.local/mcp-server.env` 生成独立的 32-byte 主密钥和 Bearer Token，并读取已有的本地 Bridge Token。生成值不会写入 README、前端包或 Git。

连接编辑器时，分别在三个终端中按顺序启动 Bridge、MCP Server 和开发页：

```powershell
npm run bridge:serve
npm run mcp:serve
npm run dev
```

随后访问 `http://localhost:3000`，点击“打开笔记”。本地开发页使用同源服务端代理，因此浏览器不会收到 MCP Bearer Token。打开笔记后，顶部状态会区分“已保存到加密草稿”和“已提交到 Obsidian”；正式写回必须经过“预览提交 → 正式提交”两步。

首次启动会自动建立搜索索引；也可以显式重建：

```powershell
npm run mcp:index -- --rebuild
```

已经注册的工具：

- `list_entries`、`read_attachment`
- `search`、`fetch`
- `create_draft`、`get_draft`、`update_draft`
- `preview_commit`、`commit_draft`
- `refresh_search_index`

权限由 Bearer Token 映射为 `userId`、`scopes` 和 `allowedPaths`。路径授权在服务端执行，不信任 Widget 或客户端传来的身份提示。草稿正文、基线正文和路径使用 AES-256-GCM 加密；搜索词元使用 HMAC，搜索文档的路径与标题也加密，SQLite 不保存笔记正文。

附件策略：PNG、JPEG、WebP 和 GIF 可以作为 MCP image content 返回；SVG 和受支持的 UTF-8 文本作为文本返回；ZIP、DOCX、PDF 等其他二进制只返回元数据，不会把 Base64 内容塞进模型上下文。

2026-07-18 在隔离数据库中验证：

- 完整列表分 4 页得到 60 篇 Markdown 和 91 个附件。
- SVG 正确恢复为 UTF-8 源码，ZIP/DOCX 按每个 LiveSync chunk 独立 Base64 解码并恢复原始文件头。
- 60 篇笔记全量索引成功，中英文搜索与 `fetch` 正常。
- MCP 无认证请求返回 `401`，10 个工具均带影响 annotations。
- 草稿经过创建、版本更新、提交预览和幂等提交，从 revision 3 写到 revision 4。
- 后台 `_changes` 监听自动捕获提交，并把新增标记增量加入搜索索引。
- 编辑器同源代理完成真实链路验收：列出隔离 Vault、创建草稿 v1、自动保存到 v2、生成变化预览，并把 `MiniCanvas Bridge Roundtrip.md` 安全提交到 revision 5。
- 并发验收中，另一个草稿先提交到 revision 6 后，基于 revision 5 的提交收到 `revision_conflict`；新内容未被覆盖，冲突草稿仍保持 `active` 且正文完整。

## 性能基线

Live Preview 已把“解析 Markdown”和“根据选区生成装饰”拆开：

- 文档正文发生变化：重新解析 token，并生成装饰
- 只移动光标或改变选区：复用 token，只更新 active 状态和装饰
- 无关事务：直接复用已有状态

`npm run benchmark` 会生成约 5 千、2 万、5 万和 10 万字符的文档，每篇固定包含 50 个块级公式，并测试初始化、连续输入、100 次光标移动、大段粘贴和源码模式切换。在当前开发机的一次基线中，四档文档执行 100 次光标移动时解析次数都保持为 1；10 万字符下初始化约 21 ms、100 次光标移动约 373 ms、连续输入 25 字符约 517 ms。具体耗时会随机器和运行时变化，应关注回归趋势而不是把这些数字当作固定指标。

当前仍是全篇解析，而不是增量 block 解析，所以超长文档的连续输入仍是下一阶段最值得优化的部分。后续可以只重解析变化附近的 block，或逐步利用 CodeMirror 语法树替代更多手写扫描。

## 规划中的整体架构

```text
ChatGPT / MCP Apps Widget
            │
            ▼
OpenAI Secure MCP Tunnel
            │
            ▼
Node.js / TypeScript MCP Server
认证 · 授权 · 草稿 · 预览 · 提交 · 搜索
            │
            ▼
TypeScript LiveSync Bridge（Node.js）
加解密 · revision · chunk · 冲突 · 幂等写入
            │
            ▼
CouchDB 密文仓库
            │
            ▼
Obsidian Self-hosted LiveSync
```

计划中的职责边界：

- **前端 / Widget**：编辑、预览和发起工具调用，不直接访问 CouchDB
- **TypeScript MCP Server（Node.js）**：用户鉴权、路径权限、草稿状态机、提交确认、搜索协调，以及注册 MCP 工具和 Widget 资源
- **TypeScript LiveSync Bridge（Node.js）**：处理 LiveSync 数据格式、加解密、附件、逻辑版本和冲突
- **CouchDB**：作为同步数据的事实来源
- **SQLite**：仅保存草稿状态和可重建的搜索索引

每次正式写入都应携带预期版本和幂等键；发现冲突时明确返回，不静默覆盖。

这里不再为 MCP 层单独引入 Python。前端、MCP Server 与 LiveSync Bridge 统一使用 TypeScript，可以直接共享 `DocumentSnapshot`、工具输入输出、权限规则、错误类型和校验模型，也只需要维护一套 Node.js 构建、测试与部署环境。MCP Server 与 LiveSync Bridge 仍保持为两个独立模块：前者负责面向 ChatGPT 的业务与权限边界，后者只负责 LiveSync 兼容和密文仓库读写，避免把 CouchDB 凭据暴露给 Widget。

## 本地页面与 ChatGPT Widget

当前通过 `http://localhost:3000` 打开的页面是一个**独立开发预览页**。它占据整个 Chrome 页面是正常现象，作用是先在本地开发和验证编辑、预览、LaTeX 与 MCP 草稿逻辑；它还不是最终嵌入 ChatGPT 的界面。

编辑器的数据调用已经抽象为统一 Tool Client：独立开发页使用本机同源代理，嵌入页面会使用 MCP Apps Bridge 的 `ui/initialize` 和 `tools/call`。接下来会把编辑器核心注册为 ChatGPT Apps SDK Widget，并复用同一套编辑、预览和草稿能力：

```text
编辑器核心
├── 本地预览外壳
│   └── 在 Chrome 中独立运行，方便开发与测试
└── ChatGPT Widget 外壳
    ├── Inline：先出现在对话中的轻量卡片
    └── Fullscreen：点击展开后的完整编辑器
```

计划中的 ChatGPT 交互流程：

```text
ChatGPT 对话
    │
    ▼
Mini Canvas Inline 卡片
    │ 点击“打开编辑器”
    ▼
Fullscreen Mini Canvas
    ├── Obsidian Live Preview 编辑区
    ├── Markdown 源码模式
    ├── ChatGPT 原生输入框
    └── ChatGPT 对话面板
```

Widget 可以通过下面的接口请求更大的展示空间：

```ts
await window.openai?.requestDisplayMode({
  mode: "fullscreen",
});
```

这里的 `request` 表示向 ChatGPT 宿主请求，最终采用哪种布局仍由 ChatGPT 决定。Apps SDK 当前公开的展示模式是 Inline、Fullscreen 和 Picture-in-picture（PiP），没有供第三方应用强制使用的固定右侧 `side-panel` 模式。因此，Mini Canvas 不能完全复制原生 Canvas 的固定左右分栏；最接近且受支持的体验是“对话内卡片 → 点击展开 → Fullscreen 编辑器”，并使用 ChatGPT 自带的输入框和对话面板。

接入时需要完成：

1. 将当前 React 编辑器打包为可嵌入的 Widget 资源。
2. 在 TypeScript MCP Server 中注册 Widget 资源和相关工具。
3. 让打开笔记等工具返回 Widget 所需的结构化数据。
4. 把已经实现的 MCP Apps Bridge Tool Client 接到正式 Widget 资源上下文中。
5. 保留本地预览页作为开发入口，不在 Widget 内重复实现 ChatGPT 对话栏。

相关官方文档：

- [Apps SDK 展示模式](https://developers.openai.com/apps-sdk/concepts/ui-guidelines#display-modes)
- [Fullscreen 设计说明](https://developers.openai.com/apps-sdk/concepts/ui-guidelines#fullscreen)
- [请求替代布局](https://developers.openai.com/apps-sdk/build/chatgpt-ui#request-alternate-layouts-chatgpt-extension)
- [构建 ChatGPT Web Component](https://developers.openai.com/apps-sdk/quickstart#build-a-web-component)
- [注册 MCP UI 资源与工具](https://developers.openai.com/apps-sdk/quickstart#build-an-mcp-server)

## 开发路线

- [x] 普通网页编辑器
- [x] Markdown 实时预览
- [x] LaTeX 公式渲染
- [x] 本地自动保存
- [x] CodeMirror 6 Obsidian Live Preview
- [x] Wiki Link、Embed、引用、脚注、Callout、Frontmatter 等第一批兼容语法
- [x] Markdown 原文保真测试
- [x] 建立独立测试 Vault 与测试 CouchDB
- [x] 实现 Node.js LiveSync Bridge 的读取、加密写回和本机 Note-level API
- [x] 验证 Obsidian 与 Bridge 双向同步且中文不乱码
- [x] 补齐 revision 冲突检测和幂等提交
- [x] 增加变更监听、附件读取和更完整的列表接口
- [x] 实现 Node.js / TypeScript MCP 草稿、授权与搜索层
- [x] 将编辑器接入 MCP 加密草稿、提交预览和安全写回
- [x] 增加本地同源 MCP 代理与 MCP Apps Bridge Tool Client
- [ ] 使用 MCP Inspector 验证工具接口
- [ ] 接入 Secure MCP Tunnel
- [ ] 将编辑器核心打包为 ChatGPT Apps SDK Widget
- [ ] 实现 Inline 卡片与 Fullscreen 编辑器切换

## 当前技术栈

- React 19
- TypeScript
- Node.js 22
- Next.js / Vinext
- CodeMirror 6
- KaTeX

## 开发原则

- 先在隔离的测试 Vault 和测试 CouchDB 中验证，避免直接操作正式笔记
- CouchDB 数据格式兼容性优先于界面功能
- 搜索索引属于派生数据，可随时从源数据重建
- 所有跨层写入都必须可审计、可重试，并能显式处理冲突

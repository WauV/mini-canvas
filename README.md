# Mini Canvas

[简体中文](./README.md) | [English](./README.en.md)

[![CI](https://github.com/WauV/mini-canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/WauV/mini-canvas/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

> 当前处于面向隔离测试 Vault 的预发布阶段。请勿在没有备份、恢复演练和权限审查的情况下直接连接正式笔记库。

一个面向 ChatGPT、Claude 与 Gemini MCP 场景的轻量写作实验项目。

当前已经完成前端编辑器、隔离测试环境中的 LiveSync V2 Bridge、Node.js / TypeScript MCP 草稿、授权、搜索和附件读取层，以及编辑器到 MCP 加密草稿的完整接入。React 编辑器已经打包为跨宿主 MCP Apps Widget；ChatGPT 通过 Secure MCP Tunnel 使用，Claude 可复用同一 Widget 协议，Gemini CLI 等纯文本 MCP 宿主使用结构化工具和草稿正文回退。

> 当前状态：普通本地“新建文档”和示例仍使用浏览器 Local Storage；ChatGPT 通过 `open_mini_canvas` 打开已有笔记，通过专用的 `create_note_in_mini_canvas` 把不存在的 `.md` 路径及完整初稿建立为可见的加密草稿。新笔记同样必须经过“预览提交 → 创建笔记”才会写入隔离 Vault；若提交前出现同名笔记则报告冲突，绝不覆盖。所有联调只使用隔离 CouchDB 与测试 Vault，正式 Vault 从未接入测试链路。

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
- 从隔离 Vault 列出并打开 Markdown 笔记，或安全准备一篇新笔记；提供可见草稿、提交预览和正式提交
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

Wiki Link 与 Embed 已接入 MCP 交互层。点击 `[[目标笔记]]` 会解析 Vault 相对路径并打开对应的加密草稿；`![[示意图.png]]`、JPEG、WebP 与 GIF 会就地显示，SVG 会先经过现有 sanitizer 再使用临时对象地址渲染，受支持的 UTF-8 文本附件显示只读预览，ZIP、PDF 等二进制只显示元数据。`![[笔记]]` 会显示可打开的笔记卡片，暂不做整篇笔记转写；`#标题` 子路径会被保留，但当前版本还不会自动滚动到目标标题。

短链接会优先按当前笔记目录和 Vault 根路径匹配，再使用唯一同名条目兜底；同名目标不唯一时会明确报错，不会猜测。附件请求通过 MCP Apps Bridge 或本地同源代理发出，浏览器不接触 Bearer Token、CouchDB 或 LiveSync 密钥。未启动本地 MCP 服务、权限不足或附件不存在时，Embed 会留在原位置显示错误，并可用“编辑”按钮回到 Markdown 源码。不认识的语法保持源码显示，不会被删除或改写。

这里的解析器是面向编辑体验的渐进式实现，不是完整的 CommonMark / GFM 合规解析器。当前已经处理转义表格分隔符、未闭合代码围栏和同行块级公式等常见边界，但复杂嵌套、任意反引号长度、深层列表与引用等情况仍需要继续补齐。原始 Markdown 始终留在 CodeMirror 文档中，因此未识别语法不会因预览而丢失。

## 项目结构

```text
mini-canvas/
├── .github/
│   ├── workflows/ci.yml            # 提交与 PR 自动质量门禁
│   └── dependabot.yml              # npm 与 Actions 每周更新
├── app/
│   ├── components/
│   │   ├── canvas/                 # 标题栏、视图栏、对话框与通知
│   │   └── Editor.tsx              # CodeMirror 6 适配层
│   ├── lib/
│   │   ├── documents/
│   │   │   ├── document-persistence-runtime.ts
│   │   │   ├── document-persistence-state.ts
│   │   │   ├── use-document-persistence.ts
│   │   │   ├── use-document-bootstrap.ts
│   │   │   ├── use-document-autosave.ts
│   │   │   ├── use-document-conflict-resolution.ts
│   │   │   ├── local-storage-repository.ts
│   │   │   ├── mcp-draft-repository.ts
│   │   │   ├── save-queue.ts
│   │   │   └── types.ts
│   │   ├── mcp/
│   │   │   ├── mini-canvas-client.ts
│   │   │   ├── tool-client.ts
│   │   │   ├── use-mcp-draft-session.ts
│   │   │   ├── vault-interaction-resolver.ts
│   │   │   └── use-widget-host.ts
│   │   ├── document-statistics.ts
│   │   ├── editor-actions.ts
│   │   ├── live-preview.ts
│   │   ├── obsidian-interactions.ts
│   │   ├── obsidian-links.ts
│   │   ├── obsidian-markdown.ts
│   │   └── svg-preview.ts
│   ├── api/mcp-tools/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   ├── MiniCanvas.tsx
│   └── page.tsx
├── tests/
│   ├── frontend/                   # 页面交互、真实 CodeMirror 与展示组件
│   ├── document-repository.test.ts
│   ├── document-statistics.test.ts
│   ├── editor-actions.test.ts
│   ├── mcp-draft-client.test.ts
│   ├── obsidian-links.test.ts
│   ├── obsidian-markdown.test.ts
│   ├── svg-preview.test.ts
│   ├── widget-host.test.ts
│   └── rendered-html.test.mjs
├── livesync-bridge/
│   ├── src/
│   └── tests/
├── mcp-server/
│   ├── src/
│   │   └── widget.ts
│   └── tests/
├── widget/
│   └── main.tsx
├── deploy/
│   ├── Caddyfile                  # 生产 HTTPS、路由与管理接口屏蔽
│   ├── examples/                  # 不含真实凭据的服务器配置样例
│   └── scripts/                   # 初始化、部署、验收与一致性备份
├── scripts/
│   ├── benchmark-markdown.ts
│   ├── setup-mcp-env.ps1
│   ├── setup-test-couchdb.ps1
│   ├── stop-test-couchdb.ps1
│   └── verify-test-environment.ps1
├── docker-compose.dev.yml
├── docker-compose.yml             # 本机隔离测试容器栈
├── docker-compose.server.yml      # Linux VPS 生产容器栈
├── Dockerfile                     # Bridge / MCP 多阶段运行镜像
├── package.json
├── vite.widget.config.ts
└── README.md
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 创建生产构建 |
| `npm run widget:build` | 把完整编辑器打包为自包含 MCP Apps Widget 资源 |
| `npm start` | 启动生产服务器 |
| `npm test` | 执行生产构建、HTML 验证、全部前端测试与覆盖率门槛 |
| `npm run test:unit` | 快速运行 Vitest 测试，不生成覆盖率报告 |
| `npm run test:coverage` | 运行前端测试并生成 `coverage/` 报告 |
| `npm run typecheck` | 检查页面与共享前端 TypeScript 类型 |
| `npm run bridge:typecheck` | 单独检查 LiveSync Bridge TypeScript 类型 |
| `npm run ci:check` | 在本机执行与 CI 等价的完整检查 |
| `npm run lint` | 检查代码规范 |
| `npm run benchmark` | 对 5 千至 10 万字符文档执行解析与编辑压力测试 |
| `npm run bridge:test` | 测试 LiveSync V2 加密和 xxHash64 兼容逻辑 |
| `npm run bridge:serve` | 启动只监听本机的 Node LiveSync Bridge API |
| `npm run mcp:test` | 测试授权、加密草稿、搜索索引、Widget 资源和 MCP 工具契约 |
| `npm run mcp:typecheck` | 单独检查 MCP Server TypeScript 类型 |
| `npm run mcp:index -- --rebuild` | 从隔离 Vault 重建加密搜索索引 |
| `npm run mcp:serve` | 启动只监听本机的 Streamable HTTP MCP Server |
| `npm run hosts:configure` | 把本机 MCP 安全配置到 Claude Code 与 Gemini CLI，不回显 Token |
| `npm run hosts:remove` | 从 Claude Code 与 Gemini CLI 移除项目级 Mini Canvas 配置 |

## 前端测试与模块边界

前端不再把全部状态和副作用堆在一个组件中。`MiniCanvas.tsx` 现在只负责组合页面；MCP 笔记选择、草稿会话、提交预览和 Widget 启动分别位于独立 Hook，标题栏与对话框也都是独立组件。这样修改某一条链路时，不需要同时触碰整页实现。

文档持久化也不是一个“大 Hook 搬家”：`use-document-persistence.ts` 只是约 125 行的组合入口，对外只返回 `state` 和稳定的 `actions` 两组接口。纯 TypeScript runtime 负责串行保存和版本状态机，reducer 负责界面状态；首次加载、320 ms 自动保存和冲突解决分别由三个小 Hook 管理。组合入口自身没有 `useRef` 或 `useEffect`，runtime 可以脱离 React 直接测试。

Vitest 使用 jsdom 与 Testing Library 验证用户真正会执行的交互，包括：

- 本地自动保存、新建确认、示例备份与恢复槽；
- 保存 runtime 的去重、串行队列、版本接收、冲突阻断和显式重试；
- 本地和 MCP 草稿的乐观锁冲突，以及“保留当前 / 载入已保存”；
- Vault 笔记筛选、草稿自动保存、提交预览、正式提交与 Widget Fullscreen；
- 真实 CodeMirror 挂载、工具栏、源码模式和只读切换；
- Live Preview 的公式、表格、Callout、Wiki Link、任务勾选和 SVG DOM 交互；
- 全部 15 个编辑器动作的空选区、完整选择、多行切换和换行边界；
- 全部 28 类当前支持的 Markdown / Obsidian token、CRLF、未闭合语法、代码/注释保护、源码保真和确定性噪声输入；
- SVG 的脚本、事件处理器、外部引用、错误 XML 和大小/元素数量限制。
- MCP 的分页、重复 cursor、畸形结构化数据、服务错误和可选 Widget 宿主能力。

覆盖率门槛由 `vitest.config.ts` 强制执行：全局语句 90%、分支 84%、函数 86%、行 91%。Markdown 解析、Live Preview、编辑器动作、SVG sanitizer 和 MCP 客户端另有更高的模块级门槛。`npm test` 会执行这些门槛；低于任一项即失败。HTML 报告只生成在已被 Git 忽略的 `coverage/`，不进入源码或生产包。

## 持续集成（CI）

GitHub Actions 会在每次 push、Pull Request 和手动触发时运行三条相互独立的检查：

- **TypeScript and lint**：检查页面、Bridge、MCP Server 类型和 ESLint；
- **Frontend build and tests**：完成 Widget 与生产页面构建、HTML 安全验证、Vitest 和覆盖率门槛；
- **Bridge and MCP tests**：验证 LiveSync 加密兼容、草稿、授权、搜索、附件和 Widget 工具契约。

CI 固定使用 Node.js 22 和 `npm ci`，完全按照锁文件安装；工作流只有只读仓库权限，同一分支的新提交会取消旧任务。前端覆盖率 HTML 会作为 7 天有效的构建产物保存。CI 不启动 Docker、不连接 CouchDB，也不读取 `.local/`、正式 Vault、LiveSync 口令或 MCP Token；这些自动化测试全部使用隔离的内存/临时数据。Dependabot 每周检查 npm 与 GitHub Actions 更新。

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

## 完整 Docker 容器栈

Bridge、MCP Server 和 CouchDB 已经可以作为一套隔离容器运行。容器模式继续复用 `mini-canvas-couchdb-test-data`，不会读取或挂载原始 Vault；MCP 的加密草稿和搜索索引保存在独立的 `mini-canvas-mcp-server-data` 数据卷中。切换前如果本机 SQLite 中还有未提交草稿，应先完成或记录，因为容器不会复制 `.local/mcp-server.sqlite`。

安全边界方面，CouchDB 与 MCP 端口只绑定宿主机 `127.0.0.1`，Bridge 不发布宿主机端口；Bridge 和 MCP API 返回禁止缓存、禁止 MIME 猜测与禁止嵌入的响应头。独立网页通过每次请求生成的 nonce 执行 CSP，ChatGPT Widget 则继续使用 MCP Apps 资源元数据中的宿主 CSP，两者互不替代。

MCP Bearer Token 至少为 32 个字符，并通过固定长度摘要进行恒时比较；连续认证失败会受到短时限制。`MINI_CANVAS_MCP_AUTH_JSON` 中的身份记录可增加 `expiresAt`（Unix 秒）以安排轮换。过期草稿默认继续加密保留 30 天，MCP Server 启动时以及每 6 小时自动清理；可通过 `MINI_CANVAS_MCP_DRAFT_RETENTION_DAYS` 调整为 1–365 天。

首次启动前仍需准备三个被 Git 忽略的文件：

- `.local/couchdb.env`
- `.local/livesync-bridge.env`
- `.local/mcp-server.env`

启动并等待整套服务通过健康检查：

```powershell
npm run container:up
```

确认容器状态、MCP 到 Bridge 的连接以及 Bridge 未发布宿主机端口：

```powershell
npm run container:verify
```

查看最近日志：

```powershell
npm run container:logs
```

停止容器但保留 CouchDB 和 MCP 数据卷：

```powershell
npm run container:down
```

容器中的访问关系为：

```text
Obsidian ── 127.0.0.1:5984 ──> CouchDB
ChatGPT / 本地代理 ── 127.0.0.1:3220 ──> MCP Server
MCP Server ── Docker 内部网络 ──> LiveSync Bridge
LiveSync Bridge ── Docker 内部网络 ──> CouchDB
```

只有 CouchDB 和 MCP Server 绑定宿主机的 `127.0.0.1`；Bridge 的 `3210` 只在 Docker 网络中可见。MCP 还通过 `MINI_CANVAS_MCP_ALLOWED_HOSTS` 校验请求的 Host，容器默认只接受 `127.0.0.1`、`localhost` 和内部服务名 `mcp-server`，防止 DNS rebinding。Node 容器使用非 root 用户、只读根文件系统、移除 Linux capabilities，并启用 `no-new-privileges`。`.dockerignore` 会把 `.local`、测试 Vault、Git 数据、覆盖率报告和本机构建产物排除在镜像上下文之外。Compose 只把忽略提交的环境文件注入对应服务：MCP 容器不会收到 CouchDB 密码或 LiveSync 口令。

网页开发服务器仍可留在宿主机运行：

```powershell
npm run dev
```

它会通过 `127.0.0.1:3220` 调用容器中的 MCP Server。不要同时运行本机的 `npm run mcp:serve`，否则会占用同一个端口。`couchdb-init` 是幂等的一次性容器，负责创建系统数据库、隔离数据库和 Obsidian 所需的 CORS/认证配置；重复启动不会清空已有密文数据。

## Linux VPS 服务器部署

服务器版使用独立的 [docker-compose.server.yml](./docker-compose.server.yml)，不会复用本地测试端口和数据卷。推荐至少准备 2 核 CPU、2 GiB 内存、充足磁盘的 Linux VPS，并安装 Git、OpenSSL、Docker Engine 与 Docker Compose 插件。

服务器拓扑如下：

```text
公网 80 / 443
      │
      ▼
    Caddy ─────────────── 自动申请和续期 TLS
      ├── mcp.example.com  ──> MCP Server
      └── sync.example.com ──> CouchDB
                                ▲
MCP Server ──> LiveSync Bridge ─┘
```

只有 Caddy 加入可以访问互联网的网络并发布端口。CouchDB、Bridge 和 MCP 使用分段的 Docker 内部网络：MCP 不能直接访问 CouchDB，Bridge 不发布任何宿主机端口。Caddy 会屏蔽 CouchDB 的 `/_node`、`/_cluster_setup`、`/_membership` 和 `/_utils` 管理路径，也不会公开 MCP 内部健康详情。

### 1. 准备域名和防火墙

准备两个不同的域名，例如：

- `mcp.example.com`：Claude Code、Gemini CLI 等远程 MCP 客户端
- `sync.example.com`：Obsidian Self-hosted LiveSync

为两个域名创建指向 VPS 公网 IP 的 A/AAAA 记录。防火墙只需允许 SSH、TCP 80、TCP/UDP 443；不要开放 5984、3210 或 3220。

### 2. 下载代码并生成生产密钥

```bash
git clone <你的仓库地址> mini-canvas
cd mini-canvas
chmod +x deploy/scripts/*.sh
./deploy/scripts/init-production.sh \
  mcp.example.com \
  sync.example.com \
  admin@example.com
```

初始化脚本会以 `umask 077` 创建：

```text
deploy/production/.env
deploy/production/secrets/
├── couchdb-admin.env
├── couchdb-app.env
├── livesync.env
├── bridge-token.env
└── mcp-server.env
```

这些路径已被 Git 忽略。脚本会分别生成 CouchDB 管理员密码、受限同步账号密码、LiveSync 端到端加密口令、Bridge 内部 Token、MCP 数据库主密钥和远程 MCP Bearer Token，不会把值打印到终端。应立即把整个 `deploy/production/` 目录加密备份到密码管理器或离线介质。

`deploy/` 与 `backups/` 同时被 `.dockerignore` 排除，不会进入 Node 镜像的 BuildKit 上下文。生产镜像只包含运行源码、锁定依赖和打包后的 MCP Apps Widget；独立的 `localhost:3000` 开发预览页不会对公网发布。

> `LIVESYNC_PASSPHRASE` 是密文格式的一部分。Vault 开始同步后不要直接修改；遗失它将无法解密远端内容。

### 3. 构建并启动

确认 DNS 已生效、服务器的 80/443 没有被其他程序占用，然后执行：

```bash
./deploy/scripts/deploy-production.sh
```

脚本会先验证 Compose，再从锁文件构建 Node 运行镜像，启动 CouchDB，创建受限数据库用户，最后启动 Bridge、MCP 和 Caddy。首次申请 TLS 通常需要几十秒。验证：

```bash
./deploy/scripts/verify-production.sh
docker compose \
  --env-file deploy/production/.env \
  -f docker-compose.server.yml ps
```

验证脚本会检查容器健康、两个域名的 TLS、未认证 MCP 请求返回 `401`，以及 CouchDB 禁止匿名访问。查看日志：

```bash
docker compose \
  --env-file deploy/production/.env \
  -f docker-compose.server.yml logs --follow --tail=100
```

### 4. 连接 Obsidian 测试 Vault

从服务器的 `deploy/production/secrets/couchdb-app.env` 读取受限同步账号，从 `livesync.env` 读取 E2EE 口令。在 Obsidian Self-hosted LiveSync 中填写：

| 配置 | 值 |
| --- | --- |
| Remote URI | `https://sync.example.com` |
| Username | `COUCHDB_APP_USER` |
| Password | `COUCHDB_APP_PASSWORD` |
| Database | `COUCHDB_DATABASE`，默认 `mini_canvas` |
| E2EE passphrase | `LIVESYNC_PASSPHRASE` |

先连接一份新的测试 Vault，完成“Obsidian 写入 → Bridge 读取 → 草稿提交 → Obsidian 收到”的闭环后再考虑迁移。部署脚本不会读取、复制或上传本机原始 Vault。

### 5. 连接 Claude Code 与 Gemini CLI

从 `mcp-server.env` 的 `MINI_CANVAS_MCP_AUTH_JSON` 中取出 `token`，通过安全渠道传到客户端机器。不要把 Token 写进 README、Git、聊天记录或 shell 历史。可在客户端用隐藏输入临时保存：

```bash
read -rsp "Mini Canvas token: " MINI_CANVAS_TOKEN && echo

claude mcp add --transport http --scope user \
  mini-canvas https://mcp.example.com/mcp \
  --header "Authorization: Bearer $MINI_CANVAS_TOKEN"

gemini mcp add --transport http --scope user \
  --description "Encrypted Obsidian drafts through Mini Canvas" \
  mini-canvas https://mcp.example.com/mcp \
  --header "Authorization: Bearer $MINI_CANVAS_TOKEN"

unset MINI_CANVAS_TOKEN
```

Gemini 第一次使用相应工作目录时仍会要求 Folder Trust；不要为了省去确认而启用全局 `--trust`。Claude Code 与 Gemini CLI 使用工具和标准 MCP Prompt。支持 MCP Apps 的 Claude 宿主还可以渲染 v10 Widget。

当前公网入口使用静态 Bearer Token，适合个人 CLI 客户端。Claude.ai、Gemini 网页 Connected Apps 和普通 ChatGPT 远程 Connector 可能要求标准 OAuth 动态注册/授权；OpenAI Secure MCP Tunnel 也属于另一条专用接入链路。因此，不要把这个 Bearer 入口描述成已经完成网页端 OAuth 发布。需要网页端多用户接入时，应在 Caddy 与 MCP Server 之间增加标准 OAuth 授权网关，并把 Token 映射为现有 `Principal`，业务层无需重写。

### 6. 备份、升级和停机

创建一致性备份：

```bash
./deploy/scripts/backup-production.sh
```

备份脚本会短暂停止服务，把 CouchDB 密文数据卷、MCP 加密草稿/索引数据卷和生产配置写入 `backups/<UTC 时间>/`，生成 SHA-256 校验文件，然后自动恢复服务。备份中包含凭据和 LiveSync 口令，必须加密保存。

升级前先备份，再拉取并重建：

```bash
./deploy/scripts/backup-production.sh
git pull --ff-only
./deploy/scripts/deploy-production.sh
./deploy/scripts/verify-production.sh
```

停止服务但保留数据卷：

```bash
docker compose \
  --env-file deploy/production/.env \
  -f docker-compose.server.yml down
```

不要添加 `--volumes`，否则会删除 CouchDB 和 MCP 数据卷。恢复演练应在另一台机器或另一组卷中进行：先核对 `SHA256SUMS`，再把两个压缩包分别还原到 `/opt/couchdb/data` 与 `/data`，同时恢复完全匹配的 `deploy/production/` 密钥；不要在运行中的数据库上直接覆盖文件。

服务器部署依据的官方资料：

- [Docker：在单服务器中使用 Compose 部署生产应用](https://docs.docker.com/compose/how-tos/production/)
- [Caddy：Automatic HTTPS 的 DNS、80/443 和持久化要求](https://caddyserver.com/docs/automatic-https)
- [CouchDB：管理员、普通用户与生产网络中的认证边界](https://docs.couchdb.org/en/stable/intro/security.html)
- [MCP：HTTP Authorization 与 OAuth 发现要求](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)

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

安全边界：本机模式默认只监听 `127.0.0.1`；容器模式允许监听 `0.0.0.0`，但 Compose 不发布 Bridge 端口，只允许 Docker 内部网络访问。业务接口要求 Bearer Token，也不开放浏览器 CORS。CouchDB 凭据和 LiveSync 口令只保存在已被 Git 忽略的 `.local/` 中，通过容器环境注入，不进入镜像或前端包。所有 CouchDB JSON 都按严格 UTF-8 解码，正文写回后还会用元数据中的 UTF-8 字节数再次校验。

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
- `edit_note_in_mini_canvas`：把已有笔记的完整修改直接打开为可见加密草稿
- `create_note_in_mini_canvas`：用必填的路径和完整正文建立新笔记的可见加密草稿
- `list_drafts`、`open_draft_in_mini_canvas`：找回草稿 ID，并把同一份加密草稿重新挂载到 Widget
- `create_draft`、`get_draft`、`update_draft`
- `preview_commit`、`commit_draft`
- `refresh_search_index`

同时注册了三个标准 MCP Prompt：

- `mini_canvas_commands`：面向操作者的快捷口令与安全路由规则
- `mini_canvas_edit_note`：完整读取已有笔记、生成完整修改、建立草稿、等待审阅
- `mini_canvas_create_note`：生成完整初稿、调用专用的新建工具、等待审阅

Prompt 和 Server instructions 都是宿主中立的：支持 MCP Apps 的宿主直接显示编辑器；不显示交互 UI 的宿主会调用 `get_draft`，把解密后的草稿正文交给用户审阅。两种路径都不会绕过 `preview_commit`、revision 检查和用户确认。`preview_commit` 会签发与用户、草稿版本和正文摘要绑定的短期确认令牌；`commit_draft` 必须携带该令牌，并向 MCP 宿主声明为破坏性写入。

### 操作者快捷口令

在选中或提及 Mini Canvas App 后，可以直接使用下面的自然语言口令。它们不是操作系统命令，而是写进 MCP Server instructions 的稳定工作流别名；标题不必写完整 Vault 路径。

| 口令 | 行为 |
| --- | --- |
| `MC 帮助` | 显示口令说明，不调用工具 |
| `MC 打开 二项式定理` | 解析标题并打开笔记；有活动草稿时优先恢复 |
| `MC 继续` | 打开最近更新的 active 草稿 |
| `MC 继续 二项式定理` | 打开指定标题对应的 active 草稿 |
| `MC 查找 傅里叶` | 搜索笔记，不建立草稿 |
| `MC 编辑 二项式定理：补一个例题` | 读取完整原文、生成完整修改并打开可见草稿，不提交 |
| `MC 新建 矩阵求导：写一篇入门讲义` | 默认在 Vault 根目录准备完整新笔记草稿，不提交 |
| `MC 状态` | 显示活动草稿的路径、状态和版本 |
| `MC 预览提交` | 为当前草稿生成提交预览，不提交 |
| `MC 提交` | 对最新版本重新预览后提交；仍遵守宿主写操作确认 |

只有 `MC 提交` 或其他明确的提交请求才授权进入提交流程。“保存”“完成”“看起来可以”等普通表达不会触发写回 Obsidian。标题有多个合理匹配时，模型只询问一次简短澄清；除 `MC 新建` 外，找不到笔记时不会自动创建。

编辑已有笔记时，ChatGPT 应先用 `search → fetch` 读取完整 Markdown，生成完整修改稿，再调用 `edit_note_in_mini_canvas({ path, content })`；这样修改会一步显示在 Widget 中，而不是只留在后台。安全新建笔记时使用专用的 `create_note_in_mini_canvas`，路径和完整初稿都是必填项，例如：

```json
{
  "path": "Notes/二项式定理.md",
  "content": "# 二项式定理\n\n$$(a+b)^n=\\sum_{k=0}^{n}\\binom{n}{k}a^{n-k}b^k$$"
}
```

这一步只创建 SQLite 中的加密草稿，不会立即修改 Vault。用户可在 Mini Canvas 中检查和编辑，再通过提交预览确认创建。需要稍后重新打开时，宿主使用返回的 `draftId` 调用 `open_draft_in_mini_canvas`；若 ID 已丢失，则先用 `list_drafts({ path?, status: "active" })` 找回。`open_mini_canvas({ path })` 也会优先恢复该路径最近的活动草稿，包括尚未提交、因而还不存在于 Vault 的新笔记。`create_draft`、`get_draft` 和 `update_draft` 同样关联 Widget。MCP Server 的初始化 `instructions` 明确规定“读取完整原文 → 生成完整修改 → 打开可见草稿 → 用户确认后才提交”的顺序；这比依赖 ChatGPT 额外读取仓库中的 `SKILL.md` 更适合 App Connector。

权限由 Bearer Token 映射为 `userId`、`scopes` 和 `allowedPaths`。路径授权在服务端执行，不信任 Widget 或客户端传来的身份提示。草稿正文、基线正文和路径使用 AES-256-GCM 加密；搜索词元使用 HMAC，搜索文档的路径与标题也加密，SQLite 不保存笔记正文。

附件策略：PNG、JPEG、WebP 和 GIF 可以作为 MCP image content 返回；SVG 和受支持的 UTF-8 文本作为文本返回；ZIP、DOCX、PDF 等其他二进制只返回元数据，不会把 Base64 内容塞进模型上下文。

2026-07-18 在隔离数据库中验证：

- 完整列表分 4 页得到 60 篇 Markdown 和 91 个附件。
- SVG 正确恢复为 UTF-8 源码，ZIP/DOCX 按每个 LiveSync chunk 独立 Base64 解码并恢复原始文件头。
- 60 篇笔记全量索引成功，中英文搜索与 `fetch` 正常。
- MCP 无认证请求返回 `401`，15 个工具均带影响 annotations。
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
ChatGPT / Claude MCP Apps · Gemini / Claude Code 文本宿主
                            │
                            ▼
          各宿主连接层（Tunnel / HTTPS OAuth / 本机 HTTP）
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
- **TypeScript MCP Server（Node.js）**：用户鉴权、路径权限、草稿状态机、提交确认、搜索协调，以及注册宿主中立的 MCP 工具、Prompt 和 Widget 资源
- **TypeScript LiveSync Bridge（Node.js）**：处理 LiveSync 数据格式、加解密、附件、逻辑版本和冲突
- **CouchDB**：作为同步数据的事实来源
- **SQLite**：仅保存草稿状态和可重建的搜索索引

每次正式写入都应携带预期版本和幂等键；发现冲突时明确返回，不静默覆盖。

这里不再为 MCP 层单独引入 Python。前端、MCP Server 与 LiveSync Bridge 统一使用 TypeScript，可以直接共享 `DocumentSnapshot`、工具输入输出、权限规则、错误类型和校验模型，也只需要维护一套 Node.js 构建、测试与部署环境。MCP Server 与 LiveSync Bridge 仍保持为两个独立模块：前者负责面向 ChatGPT 的业务与权限边界，后者只负责 LiveSync 兼容和密文仓库读写，避免把 CouchDB 凭据暴露给 Widget。

## Claude 与 Gemini

当前仓库采用同一套标准 MCP 工具、Prompt 和 MCP Apps 资源，不为不同模型复制业务服务。容器栈启动后，可以在项目根目录执行：

```powershell
npm run hosts:configure
```

脚本从已被 Git 忽略的 `.local/mcp-server.env` 读取本地 Bearer Token，并分别配置：

- Claude Code：项目级、Streamable HTTP，连接 `http://127.0.0.1:3220/mcp`
- Gemini CLI：项目级、Streamable HTTP，连接同一地址

Token 不会被脚本打印；Gemini 配置目录也被 Git 忽略。Gemini 第一次在此项目中启动时，还要在它自己的 Folder Trust 提示中确认信任 `mini-canvas` 目录，否则项目级 MCP 会显示为 Disabled。脚本不会关闭 Folder Trust，也不会启用 Gemini 的 `--trust`，因此有副作用的工具仍保留客户端确认。移除配置使用 `npm run hosts:remove`。

宿主能力不同，实际体验分为两档：

- **ChatGPT 与支持 MCP Apps 的 Claude 宿主**：v10 Widget 使用 SDK 自动协商宿主通信，不再写死 ChatGPT 的传输实现；可以直接显示 Mini Canvas、请求 Fullscreen 并在界面中审阅草稿。
- **Gemini CLI、Claude Code 等文本宿主**：可以完整使用列表、搜索、附件、加密草稿、预览和提交工具，但不假设会显示 Widget；模型应在建立草稿后调用 `get_draft` 展示或总结正文，再等待用户确认。

本机 CLI 适配不等于网页端远程发布。Claude.ai 的远程自定义连接器需要它能够访问的公网 HTTPS MCP 地址，生产连接通常还需要 OAuth；OpenAI Secure MCP Tunnel 是 ChatGPT 专用入口，不能直接给 Claude 复用。Gemini 的自定义连接能力受账号、地区和产品表面限制；在 Google 官方明确支持 MCP Apps UI 之前，本项目把 Gemini 视为工具与文本宿主，不宣称可以嵌入同一 Widget。

相关官方资料：

- [Claude：构建兼容 Claude 与 ChatGPT 的 MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/cross-compatibility)
- [Claude：远程 MCP 自定义连接器](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Gemini CLI：MCP Server 配置](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html)
- [Gemini Apps：自定义 Connected Apps 的可用范围](https://support.google.com/gemini/answer/17209137)

## 本地页面与 ChatGPT Widget

当前通过 `http://localhost:3000` 打开的页面是一个**独立开发预览页**。它占据整个 Chrome 页面是正常现象，作用是先在本地开发和验证编辑、预览、LaTeX 与 MCP 草稿逻辑；它还不是最终嵌入 ChatGPT 的界面。

编辑器的数据调用已经抽象为统一 Tool Client：独立开发页使用本机同源代理；Widget 使用官方 MCP Apps `App` 客户端完成 `ui/initialize`、接收初始工具结果并通过 `tools/call` 调用草稿工具。两个入口复用同一个 `MiniCanvas`、CodeMirror 编辑器和草稿仓库：

```text
编辑器核心
├── 本地预览外壳
│   └── 在 Chrome 中独立运行，方便开发与测试
└── ChatGPT Widget 外壳
    ├── Inline：先出现在对话中的轻量卡片
    └── Fullscreen：点击展开后的完整编辑器
```

已经实现的 ChatGPT 交互流程：

```text
ChatGPT 对话
    │
    ▼
Mini Canvas Widget
    │ 点击“全屏编辑”
    ▼
Fullscreen Mini Canvas
    ├── Obsidian Live Preview 编辑区
    ├── Markdown 源码模式
    ├── ChatGPT 原生输入框
    └── ChatGPT 对话面板
```

Widget 通过 MCP Apps 客户端向宿主请求更大的展示空间：

```ts
await app.requestDisplayMode({ mode: "fullscreen" });
```

这里的 `request` 表示向 ChatGPT 宿主请求，最终采用哪种布局仍由 ChatGPT 决定。Apps SDK 当前公开的展示模式是 Inline、Fullscreen 和 Picture-in-picture（PiP），没有供第三方应用强制使用的固定右侧 `side-panel` 模式。因此，Mini Canvas 不能完全复制原生 Canvas 的固定左右分栏；最接近且受支持的体验是“对话内卡片 → 点击展开 → Fullscreen 编辑器”，并使用 ChatGPT 自带的输入框和对话面板。

当前 Widget 封装已经完成：

1. `npm run widget:build` 生成自包含的 JavaScript、CSS 与 KaTeX 字体资源。
2. MCP Server 以 `text/html;profile=mcp-app` 暴露版本化的 Widget URI；每次改动界面或启动协议都会提升版本，避免 ChatGPT 复用旧缓存。
3. `open_mini_canvas({ path? })` 关联该 UI；无路径时打开笔记选择器，有路径时优先恢复活动草稿，否则为已有 Vault 笔记建立草稿。`open_draft_in_mini_canvas({ draftId })` 精确恢复同一份草稿；`create_note_in_mini_canvas({ path, content })` 专门准备尚未写入 Vault 的新笔记草稿。
4. Widget 只通过 MCP Apps Bridge 调用列表、草稿、预览和提交工具，不包含 Bearer Token，也不直接连接 CouchDB。
5. 本地预览页继续作为独立开发入口；Widget 内不重复实现 ChatGPT 对话栏。

本地协议验收可以在 Bridge 与 MCP Server 启动后运行：

```powershell
npm run mcp:test
npx @modelcontextprotocol/inspector@latest
```

在 Inspector 中连接 `http://127.0.0.1:3220/mcp`，并在请求头中填入本地测试 Bearer Token；然后检查 `resources/list`、读取 Widget 资源，并分别调用 `open_mini_canvas` 的空参数和指定 `path` 版本。Token 只从忽略提交的 `.local/mcp-server.env` 读取，不应复制进源码或 Widget。

把它真正添加到 ChatGPT 需要为账号开放开发者模式，并通过 OpenAI Secure MCP Tunnel 把本地 `/mcp` 安全连接到 ChatGPT。当前 Tunnel Profile 位于已被 Git 忽略的 `.local/tunnel-client/`，其中只保存 Tunnel ID 和本地目标地址；OpenAI 运行密钥与本地 MCP Bearer Token 都不会进入源码、Widget 或 Tunnel YAML。

第一次启动 Tunnel：

1. 在 OpenAI Platform 的 API Keys 页面创建用于 Tunnel 的运行密钥。
2. 执行 `npm run tunnel:save-key`，在不回显的提示框中粘贴密钥；密钥只写入 Git 忽略的 `.local/`。
3. 确认容器栈健康后执行 `npm run tunnel:start`，并在使用 ChatGPT App 期间保持该窗口运行。

启动脚本会从 `.local/mcp-server.env` 读取现有本地身份，把 Bearer 认证头仅注入 Tunnel Client 进程，并在连接控制平面前运行 `doctor`；如果 Windows 已启用系统代理，还会仅让 OpenAI 控制平面请求使用该代理，本地 MCP 请求仍直连 `127.0.0.1`。不要把 OpenAI API Key 或本地 MCP Token 粘贴到聊天、README、命令参数或 Git 中。

在 ChatGPT 创建开发者 App 时，`Connection` 必须选择 **Tunnel**，然后选择对应的 Tunnel 或填写 `tunnel_id`。不要把 OpenAI 生成的 `tunnel-service.gateway...` 地址当作普通远程 MCP URL 粘贴；那条路径会被按公开远程 MCP 的 OAuth 流程处理。Mini Canvas 面向 ChatGPT 的工具明确声明为 `noauth`，私有 Bearer Token 只用于 Tunnel Client 到本地 MCP 的内部一跳。

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
- [x] Wiki Link 点击导航与图片、SVG、文本附件 Embed 异步预览
- [x] Markdown 原文保真测试
- [x] 拆分前端持久化、MCP 草稿会话、Widget 宿主与展示组件
- [x] 建立真实 CodeMirror / 页面交互 / SVG 安全测试和覆盖率门槛
- [x] 建立独立测试 Vault 与测试 CouchDB
- [x] 实现 Node.js LiveSync Bridge 的读取、加密写回和本机 Note-level API
- [x] 验证 Obsidian 与 Bridge 双向同步且中文不乱码
- [x] 补齐 revision 冲突检测和幂等提交
- [x] 增加变更监听、附件读取和更完整的列表接口
- [x] 实现 Node.js / TypeScript MCP 草稿、授权与搜索层
- [x] 将编辑器接入 MCP 加密草稿、提交预览和安全写回
- [x] 增加本地同源 MCP 代理与 MCP Apps Bridge Tool Client
- [ ] 使用 MCP Inspector 做可视化宿主验收（自动化 MCP 协议测试已通过）
- [x] 接入 Secure MCP Tunnel，并验证控制平面轮询与本地 MCP 会话
- [x] 将编辑器核心打包为 ChatGPT Apps SDK Widget
- [x] 注册 Widget 资源与 `open_mini_canvas` 工具
- [x] 接入初始工具结果、Widget 内 MCP 工具调用和 Fullscreen 请求
- [x] 支持不存在的 Markdown 路径先生成可见加密草稿，再经预览安全创建笔记

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

## 参与贡献

欢迎通过 Issue 或 Pull Request 提交问题、测试用例和改进。在修改 LiveSync 格式、加密、授权、草稿提交或服务器部署逻辑时，请同时补充对应测试，并确保 `npm run ci:check` 完整通过。

提交日志、截图和复现资料前，请移除 Vault 正文、CouchDB 凭据、LiveSync 口令、MCP Token、OpenAI API Key 与服务器域名等私人信息。安全漏洞不应附带真实密钥或正式 Vault 数据公开提交。

## 开源许可

Mini Canvas 采用 [Apache License 2.0](./LICENSE) 开源，版权归 `WauV` 及项目贡献者所有。你可以在协议允许的范围内使用、修改和分发本项目；再分发时须保留许可证、版权与归属声明。第三方依赖继续遵循各自的许可证，补充归属信息见 [NOTICE](./NOTICE)。

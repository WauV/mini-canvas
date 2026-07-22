# Mini Canvas

[简体中文](./README.md) | [English](./README.en.md)

[![CI](https://github.com/WauV/mini-canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/WauV/mini-canvas/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

> Mini Canvas is currently a pre-release project designed for an isolated test Vault. Do not connect a production knowledge base before you have a verified backup, a restore drill, and an explicit permission review.

Mini Canvas is a lightweight Obsidian-oriented Markdown editor and MCP application for ChatGPT, Claude, and Gemini workflows. It keeps Markdown as the source of truth, provides a CodeMirror 6 Live Preview experience, and writes through encrypted, reviewable drafts instead of modifying an Obsidian Vault immediately.

The repository includes the editor, an MCP Apps Widget, a TypeScript MCP server, an Obsidian Self-hosted LiveSync-compatible bridge, encrypted draft and search storage, a local test stack, and a hardened single-server Docker deployment.

## Highlights

- CodeMirror 6 single-pane Live Preview and source modes
- Markdown remains the only document representation; no rich-text round trip
- CommonMark/GFM essentials plus an Obsidian-oriented syntax subset
- Wiki Links, Embeds, block quotes, footnotes, Callouts, highlights, tags, comments, block IDs, and Frontmatter
- Interactive task lists and Markdown tables
- Inline and block LaTeX rendered with KaTeX
- Sanitized inline SVG and fenced `svg` previews
- Image, SVG, and UTF-8 text attachment previews through MCP
- Local browser persistence and encrypted MCP draft repositories behind one interface
- Optimistic draft versions, revision conflicts, idempotent commits, and explicit commit previews
- LiveSync V2-compatible chunk encryption and binary attachment decoding
- Encrypted SQLite drafts and HMAC-tokenized search indexes
- Streamable HTTP MCP tools, standard MCP Prompts, and an MCP Apps Widget
- Host-neutral Widget transport for ChatGPT and Claude
- Text fallback for Claude Code, Gemini CLI, and other non-UI MCP hosts
- Local Docker test stack and a separate Linux VPS production stack

## Project status

The editor, LiveSync Bridge, MCP draft/search/authorization layers, attachment reads, Widget integration, and isolated round-trip tests are implemented. The v10 Widget has been exercised through ChatGPT's Secure MCP Tunnel. Claude-compatible MCP Apps transport negotiation and Claude Code/Gemini CLI configuration are included.

Local “new document” and sample actions still use browser Local Storage. Vault-backed notes use encrypted SQLite drafts and must go through:

```text
read current revision
        ↓
create/update encrypted draft
        ↓
review commit preview
        ↓
explicit commit
        ↓
LiveSync revision-checked write
```

A missing `.md` path can be prepared as a new-note draft, but the Vault is not changed until the user reviews and commits it. If the path appears before commit, the operation reports a conflict instead of overwriting it.

## Quick start

### Requirements

- Node.js 22.13 or newer
- npm

### Install and run the standalone development page

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

This standalone page is for editor development and local testing. Vault access additionally requires the CouchDB, LiveSync Bridge, and MCP services described below.

## Editor syntax

### Markdown and Obsidian extensions

```markdown
# Heading

This is **bold**, *italic*, ==highlighted==, and ~~deleted~~ text.

- A normal list item
- [x] Completed task
- [ ] Pending task

> A block quote

> [!note] Callout title
> Callout content

An internal link: [[Fourier Transform|Fourier notes]]
An attachment: ![[diagram.svg]]

A footnote reference[^1] and an inline footnote.^[Inline note]

[^1]: Footnote definition
```

Currently supported Obsidian-oriented syntax includes:

- `[[Internal link]]` and `[[Target|Alias]]`
- `![[Note or attachment]]`
- block quotes and `> [!type]` Callouts
- footnote references, definitions, and inline footnotes
- `==highlight==`
- nested tags such as `#topic/subtopic`
- `%%comments%%`
- `^block-id`
- YAML Frontmatter
- inline and block LaTeX
- inline SVG and fenced `svg` blocks

The parser is deliberately progressive rather than a complete CommonMark/GFM implementation. Unknown or unsupported syntax remains in the underlying CodeMirror document and is never discarded.

### LaTeX

```markdown
Einstein's equation is $E = mc^2$.

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$
```

### SVG

```markdown
<svg viewBox="0 0 240 80" role="img" aria-label="Mini Canvas example">
  <rect width="240" height="80" rx="16" fill="#f4e2d6" />
  <text x="120" y="48" text-anchor="middle" fill="#75422f">
    Mini Canvas
  </text>
</svg>
```

Or use a fenced block:

````markdown
```svg
<svg viewBox="0 0 120 40">
  <circle cx="20" cy="20" r="14" fill="#d97757" />
  <path d="M44 20 H108" stroke="#75422f" stroke-width="4" />
</svg>
```
````

SVG is parsed as XML, sanitized, and rendered through an isolated image URL. Scripts, event attributes, `foreignObject`, animation elements, and external resource references are removed. TikZ is intentionally out of scope.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd + B | Toggle bold |
| Ctrl/Cmd + I | Toggle italic |
| Ctrl/Cmd + K | Insert a link |
| Tab | Insert indentation |

The toolbar also toggles headings, quotes, lists, task lists, footnotes, Callouts, code, links, and math syntax.

## Live Preview model

Live Preview only adds CodeMirror decorations to the original Markdown. Moving the cursor into a heading, formula, Wiki Link, or another decorated range reveals the source. The source mode can always show the complete unmodified text.

Markdown parsing and selection-dependent decorations are separated:

- document changes parse tokens and rebuild decorations;
- selection-only changes reuse tokens and update active ranges;
- unrelated editor transactions reuse the existing state.

Wiki Links and Embeds use an asynchronous MCP resolution layer. Short links first try the current note directory and the Vault root, then fall back to a unique same-name match. Ambiguous targets produce an error rather than a guess.

## Architecture

```text
ChatGPT / Claude MCP Apps · Claude Code / Gemini CLI
                         │
                         ▼
       Tunnel / HTTPS Bearer / future OAuth gateway
                         │
                         ▼
             TypeScript MCP Server
 auth · paths · encrypted drafts · preview · commit · search
                         │
                         ▼
             TypeScript LiveSync Bridge
 crypto · chunks · attachments · revisions · idempotency
                         │
                         ▼
                  CouchDB ciphertext
                         │
                         ▼
          Obsidian Self-hosted LiveSync
```

Component boundaries:

- **Editor / Widget** — editing, preview, and MCP tool calls; never receives CouchDB credentials or LiveSync keys.
- **MCP Server** — user identity, scopes, allowed paths, encrypted drafts, search coordination, commit confirmation, tools, Prompts, and UI resources.
- **LiveSync Bridge** — LiveSync-compatible encryption, metadata, chunks, attachments, revisions, and idempotent writes.
- **CouchDB** — encrypted synchronization source of truth.
- **SQLite** — encrypted drafts and a rebuildable encrypted search index.

The MCP server never talks directly to CouchDB. The Widget never talks directly to the Bridge.

## Repository layout

```text
mini-canvas/
├── app/                         # React editor and local API proxy
│   ├── components/
│   ├── lib/documents/           # persistence state machine and repositories
│   ├── lib/mcp/                 # MCP Apps/local tool clients and resolvers
│   ├── MiniCanvas.tsx
│   └── globals.css
├── widget/                      # MCP Apps Widget entry point
├── livesync-bridge/             # LiveSync-compatible bridge and tests
├── mcp-server/                  # auth, drafts, search, tools, resources
├── deploy/
│   ├── Caddyfile                # production HTTPS reverse proxy
│   ├── examples/                # secret-free deployment examples
│   └── scripts/                 # init, deploy, verify, and backup
├── scripts/                     # local test and tunnel scripts
├── tests/                       # editor, parser, MCP, and deployment tests
├── docker-compose.yml           # isolated local test stack
├── docker-compose.server.yml    # Linux VPS production stack
├── Dockerfile
└── README.md / README.en.md
```

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the standalone development page |
| `npm run build` | Build the Widget and production web bundle |
| `npm run widget:build` | Build the self-contained MCP Apps Widget |
| `npm run typecheck` | Type-check the frontend/shared code |
| `npm run bridge:typecheck` | Type-check the LiveSync Bridge |
| `npm run mcp:typecheck` | Type-check the MCP server |
| `npm run lint` | Run ESLint |
| `npm test` | Build and run frontend tests with coverage gates |
| `npm run ci:check` | Run the full local equivalent of CI |
| `npm run bridge:test` | Test LiveSync formats, crypto, revisions, and server config |
| `npm run mcp:test` | Test auth, drafts, search, tools, Prompts, and Widget resources |
| `npm run benchmark` | Benchmark 5K–100K-character Markdown documents |
| `npm run container:up` | Build and start the isolated local stack |
| `npm run container:verify` | Verify local container health and isolation |
| `npm run container:down` | Stop local containers without deleting volumes |
| `npm run hosts:configure` | Configure local Claude Code and Gemini CLI clients |
| `npm run hosts:remove` | Remove those local client entries |

## Local isolated environment

The local stack is intentionally separate from production:

- Vault: `.local/obsidian-test-vault`
- CouchDB database: `mini_canvas_test`
- CouchDB volume: `mini-canvas-couchdb-test-data`
- MCP data volume: `mini-canvas-mcp-server-data`
- credentials: ignored files under `.local/`

Prepare the local environment files, then run:

```powershell
npm run container:up
npm run container:verify
```

Local network exposure:

```text
Obsidian        → 127.0.0.1:5984 → CouchDB
Local clients   → 127.0.0.1:3220 → MCP Server
MCP Server      → private Docker network → LiveSync Bridge
LiveSync Bridge → private Docker network → CouchDB
```

The Bridge never publishes a host port. Do not run `docker compose down -v` unless you intentionally want to delete local test data.

## Linux VPS deployment

The server deployment uses [docker-compose.server.yml](./docker-compose.server.yml), not the local test Compose file. A small VPS with at least 2 CPU cores, 2 GiB of RAM, and adequate persistent storage is recommended. Install Git, OpenSSL, Docker Engine, and the Docker Compose plugin.

### Production topology

```text
Internet :80 / :443
        │
        ▼
      Caddy ───────────── automatic TLS
        ├── mcp.example.com  ──> MCP Server
        └── sync.example.com ──> CouchDB
                                  ▲
 MCP Server ──> LiveSync Bridge ──┘
```

Only Caddy joins an internet-capable Docker network and publishes ports. CouchDB, the Bridge, and MCP use segmented internal networks; MCP and CouchDB do not share a network. Caddy blocks CouchDB administration paths and hides the detailed MCP health route.

### 1. DNS and firewall

Create two DNS records pointing to the VPS:

- `mcp.example.com` for remote MCP CLI clients;
- `sync.example.com` for Obsidian Self-hosted LiveSync.

Allow SSH, TCP 80, and TCP/UDP 443. Do not expose 5984, 3210, or 3220.

### 2. Clone and generate production secrets

```bash
git clone <your-repository-url> mini-canvas
cd mini-canvas
chmod +x deploy/scripts/*.sh

./deploy/scripts/init-production.sh \
  mcp.example.com \
  sync.example.com \
  admin@example.com
```

The script creates mode-`600` files under the ignored `deploy/production/` directory:

```text
deploy/production/.env
deploy/production/secrets/
├── couchdb-admin.env
├── couchdb-app.env
├── livesync.env
├── bridge-token.env
└── mcp-server.env
```

It generates separate CouchDB administrator and application passwords, a LiveSync E2EE passphrase, an internal Bridge token, an MCP database master key, and a remote MCP Bearer token. Values are not printed. Back up this directory immediately in an encrypted password manager or offline store.

`deploy/` and `backups/` are also excluded from the Docker BuildKit context. Production images contain the runtime code, locked dependencies, and the MCP Apps Widget, not deployment secrets or the standalone development page.

> The LiveSync passphrase is part of the ciphertext format. Do not change it after synchronization begins unless you are performing a planned migration.

### 3. Deploy and verify

After DNS resolves and ports 80/443 are free:

```bash
./deploy/scripts/deploy-production.sh
./deploy/scripts/verify-production.sh
```

Inspect the stack or follow logs:

```bash
docker compose \
  --env-file deploy/production/.env \
  -f docker-compose.server.yml ps

docker compose \
  --env-file deploy/production/.env \
  -f docker-compose.server.yml logs --follow --tail=100
```

The verifier checks container health, TLS on both domains, `401` responses for unauthenticated MCP requests, and CouchDB anonymous-access rejection.

### 4. Connect an isolated Obsidian Vault

Read the restricted account from `couchdb-app.env` and the E2EE passphrase from `livesync.env`:

| Self-hosted LiveSync setting | Value |
| --- | --- |
| Remote URI | `https://sync.example.com` |
| Username | `COUCHDB_APP_USER` |
| Password | `COUCHDB_APP_PASSWORD` |
| Database | `COUCHDB_DATABASE` (default: `mini_canvas`) |
| E2EE passphrase | `LIVESYNC_PASSPHRASE` |

Start with a new test Vault and complete a full round trip before migrating any real notes. Deployment scripts do not read, copy, or upload your original local Vault.

### 5. Connect Claude Code and Gemini CLI

Securely transfer the `token` inside `MINI_CANVAS_MCP_AUTH_JSON` to the client machine. Do not store it in Git, screenshots, chat logs, or shell history.

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

Gemini still requires Folder Trust for each relevant project directory. Do not enable global `--trust` merely to remove confirmation prompts.

The public endpoint currently uses a static Bearer token and is intended for personal CLI clients. Claude.ai, Gemini web Connected Apps, and ordinary remote ChatGPT connectors may require standards-compliant OAuth discovery and authorization. OpenAI Secure MCP Tunnel is a separate dedicated connection path. For multi-user web publication, place an OAuth authorization gateway in front of the MCP server and map validated identities to the existing `Principal` model.

### 6. Backup and upgrade

Create a consistent backup:

```bash
./deploy/scripts/backup-production.sh
```

The script briefly stops the stack, archives CouchDB ciphertext, encrypted MCP drafts/search state, and matching production configuration, writes SHA-256 checksums, and restarts the services. The backup contains credentials and must itself be encrypted.

Upgrade flow:

```bash
./deploy/scripts/backup-production.sh
git pull --ff-only
./deploy/scripts/deploy-production.sh
./deploy/scripts/verify-production.sh
```

Stop services without deleting volumes:

```bash
docker compose \
  --env-file deploy/production/.env \
  -f docker-compose.server.yml down
```

Never add `--volumes` unless permanent data deletion is intentional. Restore into a separate machine or fresh volume set, verify `SHA256SUMS`, and restore the matching secrets together with the data. Never overwrite a running CouchDB data directory.

Official deployment references:

- [Docker: Use Compose in production](https://docs.docker.com/compose/how-tos/production/)
- [Caddy: Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [CouchDB: Security](https://docs.couchdb.org/en/stable/intro/security.html)
- [MCP: HTTP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)

## LiveSync Bridge

The TypeScript Bridge is compatible with the isolated Vault's LiveSync V2 representation:

- `PBKDF2-SHA256 → HKDF-SHA256 → AES-256-GCM`
- encrypted `xxHash64` chunk IDs
- metadata/chunk reconstruction
- strict UTF-8 and byte-length validation
- per-chunk Base64 decoding for binary `newnote` attachments
- logical revisions, conflict detection, and idempotent commits
- paginated entries, long-poll change events, and read-only attachments

Bridge HTTP endpoints:

| Method and path | Purpose | Auth |
| --- | --- | --- |
| `GET /health` | Internal health check | None |
| `POST /v1/notes/read` | Read and decrypt a note | Bearer |
| `POST /v1/notes/commit` | Revision-checked encrypted commit | Bearer |
| `POST /v1/entries/list` | Paginated note/attachment metadata | Bearer |
| `POST /v1/changes/poll` | Opaque-sequence long polling | Bearer |
| `POST /v1/attachments/read` | Read decrypted attachment bytes | Bearer |

Every write includes an expected revision and an idempotency key. A stale revision returns a conflict and never silently replaces the newer Obsidian content.

## TypeScript MCP Server

The MCP server uses Streamable HTTP and only calls the Bridge. It does not hold CouchDB administrator credentials or the LiveSync passphrase.

Registered tools:

- `open_mini_canvas`
- `list_drafts`
- `open_draft_in_mini_canvas` — reopens the exact encrypted draft in the Widget by `draftId`
- `create_note_in_mini_canvas` — prepares a new note as a visible encrypted draft with required `path` and `content`
- `list_entries`
- `read_attachment`
- `search`
- `fetch`
- `edit_note_in_mini_canvas`
- `create_draft`
- `get_draft`
- `update_draft`
- `preview_commit`
- `commit_draft`
- `refresh_search_index`

Registered MCP Prompts:

- `mini_canvas_commands`
- `mini_canvas_edit_note`
- `mini_canvas_create_note`

The safe edit workflow is:

```text
search → fetch full Markdown → produce full revision
       → edit_note_in_mini_canvas → user review → preview_commit → commit_draft
```

MCP Apps hosts render the encrypted draft. Text-only hosts call `get_draft` and present the returned Markdown for review. Neither flow commits without explicit user approval. `preview_commit` issues a short-lived confirmation token bound to the user, draft version, and content digest; `commit_draft` requires that token and is advertised to MCP hosts as a destructive write.

### Operator shorthand commands

After selecting or mentioning the Mini Canvas App, operators can use concise Chinese commands instead of spelling out tool names or full Vault paths. These are conversational aliases encoded in the MCP server instructions, not operating-system commands.

| Command | Behavior |
| --- | --- |
| `MC 帮助` | Show command help without calling tools |
| `MC 打开 <title>` | Resolve the title and open the note, resuming an active draft when present |
| `MC 继续 [title]` | Reopen the latest active draft, optionally restricted by title |
| `MC 查找 <query>` | Search without creating a draft |
| `MC 编辑 <title>：<request>` | Read the complete note, prepare a full revision and open a visible draft |
| `MC 新建 <title>：<request>` | Prepare a complete new-note draft at the Vault root unless a folder is supplied |
| `MC 状态 [title]` | Show draft path, status, version and update time |
| `MC 预览提交 [title]` | Generate a commit preview without committing |
| `MC 提交 [title]` | Preview the latest version and then request the protected commit action |

Only `MC 提交` or another explicit commit request authorizes the commit workflow. Casual phrases such as “save”, “done”, or “looks good” do not write to Obsidian. Ambiguous titles cause one concise clarification, and missing notes are never created outside the explicit `MC 新建` workflow.

To reopen an uncommitted draft, call `open_draft_in_mini_canvas({ draftId })`. If the identifier is no longer in the conversation, recover it with `list_drafts({ path?, status: "active" })`. Calling `open_mini_canvas({ path })` also resumes the most recently active draft for that exact path before attempting to read the note from the Vault, so a not-yet-committed new note can be reopened safely.

### Authorization and encrypted storage

Static test/server tokens map to:

- `userId`
- scopes
- allowed Vault path prefixes
- optional expiration

Available scopes include note reads, Vault listing, attachment reads, draft writes/commits, search reads, and index refreshes. Paths are normalized and checked server-side; absolute paths, traversal, null bytes, and reserved paths are rejected.

Draft and baseline bodies are encrypted with AES-256-GCM under keys derived from a 32-byte master key. Search terms are HMAC-tokenized; paths and titles are encrypted; plaintext note bodies are not stored in the index. Search hits read a small number of candidate notes through the Bridge and generate snippets in memory.

Attachment delivery policy:

- PNG, JPEG, WebP, and GIF: MCP image content, up to 8 MiB
- SVG and supported UTF-8 text/source formats: text, up to 2 MiB
- ZIP, DOCX, PDF, and other binaries: metadata only
- attachments are read-only in the current release

## Host integration

### ChatGPT

The Widget is exposed as a versioned `text/html;profile=mcp-app` resource. It supports Inline and Fullscreen requests. ChatGPT does not expose a third-party fixed right-side Canvas layout, so the supported experience is an inline card that can request Fullscreen.

The current personal ChatGPT setup uses OpenAI Secure MCP Tunnel. The tunnel injects the private local Bearer token between the tunnel client and the MCP server; the public App-facing tools declare `noauth`. Do not paste the generated `tunnel-service.gateway...` URL as an ordinary remote MCP URL, because that invokes remote OAuth discovery instead of the Tunnel connection mode.

### Claude

The Widget calls `App.connect()` without a hard-coded transport, allowing the MCP Apps SDK to negotiate the ChatGPT or Claude host. Claude Code can use the same tools and Prompts over Streamable HTTP even when it does not render the Widget.

See [Claude's cross-platform MCP Apps guide](https://claude.com/docs/connectors/building/mcp-apps/cross-compatibility).

### Gemini

Gemini CLI uses the standard tools, resources, and Prompts with a text review fallback. Embedded MCP Apps Widget support is not assumed. Gemini's web Connected Apps availability depends on account, region, and product support.

See [Gemini CLI MCP configuration](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html).

## Testing and CI

The test suite covers:

- Local Storage and MCP draft persistence
- save queues, optimistic versions, conflict recovery, and idempotency
- real CodeMirror mounting, toolbars, source mode, and read-only mode
- Markdown/Obsidian tokens, CRLF, unclosed syntax, and source fidelity
- Wiki Link navigation and asynchronous image/SVG/text Embeds
- SVG sanitizer limits and unsafe element/attribute removal
- LiveSync crypto, binary chunks, entry/change APIs, and revisions
- authentication, path scopes, encrypted drafts, search, tools, Prompts, and Widget resources
- production Compose exposure, network segmentation, ignored secrets, and proxy restrictions

Coverage gates currently require at least:

- statements: 90%
- branches: 84%
- functions: 86%
- lines: 91%

GitHub Actions runs TypeScript/lint, frontend build/tests, and Bridge/MCP tests with read-only repository permissions. CI never reads local secrets, a real Vault, or a live CouchDB.

## Performance baseline

`npm run benchmark` generates approximately 5K, 20K, 50K, and 100K-character documents with 50 block formulas and measures initialization, typing, cursor movement, paste, and source-mode switching.

Selection movement reuses parsed tokens, but document edits still perform a full-document parse. Block-level incremental parsing remains a future optimization for very large notes.

## Roadmap

Completed:

- [x] Standalone Markdown/LaTeX editor
- [x] CodeMirror 6 Obsidian-style Live Preview
- [x] Wiki Links, Embeds, Callouts, footnotes, Frontmatter, SVG
- [x] Persistence modules, tests, coverage gates, and CI
- [x] Isolated Vault and CouchDB environment
- [x] LiveSync-compatible read/write Bridge
- [x] revisions, idempotency, attachments, lists, and change polling
- [x] TypeScript MCP auth, drafts, search, and commit workflow
- [x] MCP Apps Widget and ChatGPT Secure MCP Tunnel integration
- [x] Claude host transport negotiation and Gemini/Claude Code text fallback
- [x] Hardened single-VPS Docker deployment and backup workflow

Remaining or optional:

- [ ] Visual host acceptance with MCP Inspector
- [ ] Standards-compliant OAuth gateway for multi-user web connectors
- [ ] Block-level incremental Markdown parsing
- [ ] Broader CommonMark/GFM edge-case coverage

## Technology

- React 19
- TypeScript
- Node.js 22
- Next.js / Vinext
- CodeMirror 6
- KaTeX
- MCP SDK and MCP Apps SDK
- SQLite
- CouchDB
- Docker Compose and Caddy

## Development principles

- Validate against an isolated test Vault before touching real notes.
- Prefer LiveSync data compatibility and recoverability over UI convenience.
- Treat search indexes as disposable derived data.
- Make every cross-layer write auditable, retryable, idempotent, and conflict-aware.
- Keep credentials and plaintext note bodies out of the browser and image build context.
- Do not claim host UI or OAuth support that has not been verified.

## Contributing

Issues, test cases, documentation improvements, and pull requests are welcome. Changes to LiveSync formats, encryption, authorization, draft commits, or server deployment should include matching tests and pass:

```bash
npm run ci:check
```

Remove note content, CouchDB credentials, LiveSync passphrases, MCP tokens, OpenAI API keys, private domains, and other personal data from logs, screenshots, and reproductions. Never publish a real secret or production Vault as part of a security report.

## License

Mini Canvas is licensed under the [Apache License 2.0](./LICENSE), with copyright held by `WauV` and project contributors. You may use, modify, and distribute the project under the terms of that license. Redistributions must retain the applicable license, copyright, and attribution notices. Third-party dependencies remain subject to their respective licenses; see [NOTICE](./NOTICE) for additional attribution information.

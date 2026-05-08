# Claude Coder

A VS Code extension that brings agentic coding to the editor, powered by the
official [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).
Cursor-style chat experience: 5-mode switcher (`Plan` / `Debug` / `Multitask` /
`Ask` / `Agent`), parallel subagents, live context-window indicator,
auto-loaded project memory (`CLAUDE.md` / `AGENTS.md` / `.cursorrules`),
**workspace indexer** (auto file-tree + key-file excerpts), **Plan view**
(takes over the sidebar with a Build dialog), and **per-run permission control**
(orthogonal to mode).

![Claude Coder screenshot](./media/screenshot.png)

## What it does

- **Sidebar chat** in its own activity bar container, with the Cursor composer
  layout: a `+` menu, a removable mode pill, the **permission pill** (Read-only
  / Ask first / Auto-approve), an inline model selector, a mic placeholder,
  and a round Claude-orange send button.
- **5 modes** — tap `+` to switch:
  - **Plan** — read-only exploration. Two-turn protocol: the agent first asks
    **exactly 2 clarifying questions**, then (after you answer) writes a
    numbered plan that takes over the sidebar in the **Plan view**. A
    `← Back to chat` button flips between the views without losing context.
  - **Debug** — hypothesis-driven loop: form a hypothesis, run a verifying
    experiment, cite the runtime evidence, refine.
  - **Multitask** — the main agent dispatches independent sub-tasks in
    parallel via the SDK `Agent` tool with a `worker` subagent definition;
    nested messages render under their parent's "subagent · worker" block.
  - **Ask** — read-only Q&A; no plans, no edits.
  - **Agent** — the default; full toolset, edits gated by approval.
- **Workspace indexer** — every turn, a compact file tree (≤ ~10 KB,
  `.gitignore`-aware, capped at 250 files / 4 levels) plus excerpts of
  `package.json`, `tsconfig.json`, `pyproject.toml`, `Cargo.toml`,
  `README.md`, `requirements.txt`, `Makefile`, `.env.example` is appended to
  the system prompt so the model knows the codebase layout without having to
  call Glob/Read first. Cached per session; invalidated 2 s after any
  workspace file save (debounced).
- **Plan view + Build dialog** — when Plan mode produces a plan, the panel
  flips to a full-width view with streaming markdown. A header dialog at the
  bottom mirrors the Cursor "Accept this plan?" experience:
  - **`1` Build (auto-approve edits)** — orange-highlighted default.
    Switches to Agent mode and runs with `acceptEdits` so edits apply
    without prompts.
  - **`2` Build with approval (review each edit)** — same switch but each
    Edit/Write/Bash routes through the approval dialog.
  - **`3` No, keep refining** — sends the follow-up text back into Plan mode
    on the same session so prior plan text stays in context.
  - **Open in editor** (↗) — mirrors the plan to a read-only
    `claude-coder-plan:` virtual document opened in a side editor tab.
- **Per-run permission pill** (orthogonal to Mode) — cycles
  Read-only → Ask first → Auto-approve. "Read-only" intersects the active
  mode's tool list with the read-only set for that one run; "Ask first" uses
  the SDK's `default` mode + `canUseTool`; "Auto-approve" uses `acceptEdits`.
  See the orthogonality table below.
- **Persistent permissions panel** (lock icon top-right of the chat) — pick
  which tool groups are allowed and whether edits should auto-approve, save
  to workspace settings (`claudeCoder.allowedTools` +
  `claudeCoder.permissionMode`).
- **Streams** `assistant`, `tool_use`, and `tool_result` events from the SDK
  in real time. Subagent traffic is keyed by `parent_tool_use_id` so parallel
  workers never collapse into each other.
- **Approval-gated tools** — `Edit` / `Write` / `Bash` route through a
  `canUseTool` round-trip with a unified diff preview and Allow / Deny dialog.
  Read-only tools (`Read` / `Glob` / `Grep` / `WebSearch` / `WebFetch` /
  `TodoWrite`) are pre-approved by default.
- **Live context indicator** — a thin bar above the composer shows
  `47.2k / 200k (24%)` with an input/output/cache breakdown on click. Color
  bands turn amber at 60% and red at 85%.
- **`CLAUDE.md` / `AGENTS.md` / `.cursorrules`** are read from the workspace
  root on every turn (truncated to 8 KB each) and inserted into the system
  prompt **before** the indexer's tree+excerpts and the mode prompt — your
  curated guidance has top priority.
- **`@`-mention** workspace files via `vscode.workspace.findFiles`.
- **Slash commands**: `/help`, `/clear`, `/new`, `/resume`, `/cost`,
  `/model`, `/plan` (re-open the plan view).
- **Per-workspace session resume** — `session_id` persisted in
  `workspaceState`; `New Session` clears it.
- **Stop button** wired to an `AbortController` passed into `query()`.
- **API key in `vscode.SecretStorage`** — never written to disk in plain text.

## Permission × Mode orthogonality

The two axes compose cleanly. Mode controls *what* the agent can do
(tool list + system prompt + behavior); Permission controls *how much trust*
the user grants for that single run.

| Mode | Permission | Effect |
|---|---|---|
| Plan | (any) | Read-only tools regardless — Plan mode strips Edit/Write/Bash from the tool list. The pill still tightens (`readOnly` would intersect again) but never expands. |
| Agent | Read-only | Agent system prompt + read-only tool intersection (good for "agent reasoning, no edits"). |
| Agent | Ask first | Default — `canUseTool` prompts on Edit/Write/Bash with a diff. |
| Agent | Auto-approve | `acceptEdits` — no prompts on edits. Used by Plan view's **Build** action. |
| Multitask | Auto-approve | `acceptEdits` cascades into subagents too. |

## Install (from the .vsix)

```bash
# In VS Code or Cursor:
code --install-extension claude-coder-0.0.3.vsix
# Or: Command Palette → "Extensions: Install from VSIX…" → pick the file.
```

The packaged `.vsix` lives at the project root (`claude-coder-0.0.3.vsix`).

## First run

1. Click the Claude Coder icon in the activity bar.
2. The empty-state shows **Set Anthropic API Key…** — click it (or run
   `Claude Coder: Set Anthropic API Key…` from the command palette).
3. Paste your `sk-ant-…` key. It is stored in VS Code's `SecretStorage`.
4. (Optional) drop a `CLAUDE.md` in your repo root to ground the agent.
5. Type a prompt and press <kbd>Enter</kbd>. Try:
   - Default Agent mode: `read package.json and tell me what scripts are defined`
   - Switch to Plan: `Plan how to add a --verbose flag to src/main.ts` —
     answer the 2 questions, watch the Plan view stream the plan, then click
     **Build** to switch to Agent mode and execute with auto-approved edits.
   - Switch to Multitask: `Add JSDoc to add() in demo.js AND sub() in two.js — they're independent, split them up`
   - Toggle the **lock** icon to open the persistent permissions panel.
   - Cycle the **permission pill** (next to the mode pill) to apply
     read-only / ask-first / auto-approve to the *next* run only.
   - `@README.md what's missing in this doc?`

When Claude proposes an `Edit` or `Write`, you'll see a diff preview with
**Allow once** / **Deny…** buttons. Bash commands show the exact command
to be run.

## Modes — quick reference

| Mode | Tools | Pre-approved | Notable behavior |
|------|-------|--------------|------------------|
| Agent | `Read` `Write` `Edit` `Bash` `Glob` `Grep` `WebSearch` `WebFetch` `TodoWrite` | read-only set | Default. Edits gated by approval (or auto-approved if the pill is set to ⚡). |
| Plan | `Read` `Glob` `Grep` `WebSearch` `WebFetch` `TodoWrite` | all tools (no approval) | Two-turn protocol: 2 questions → plan. Plan view takes over the sidebar; **Build** dispatches Agent + `acceptEdits`. |
| Ask | (same as Plan) | all tools | "Just answer." No plans, no tasks. |
| Multitask | (Agent) + `Agent` tool with `worker` subagent | read-only + `Agent` | Dispatches workers in parallel; nested view by `parent_tool_use_id`. |
| Debug | (Agent set) | read-only set | Scientific-method system prompt. |

## Develop

Requirements: Node 18+, npm, VS Code 1.92+.

```bash
cd claude-coder
npm install
npm run build      # builds dist/extension.js + webview-ui/dist
```

Then either:

- Open this folder in VS Code and press <kbd>F5</kbd> to launch the
  Extension Development Host.
- Or run from CLI:
  ```bash
  code --extensionDevelopmentPath=$(pwd)
  ```

A `.vscode/launch.json` is included that runs `npm: build` as a pre-launch
task and points at `dist/extension.js`.

### Useful scripts

| Script | What it does |
|--------|-------------|
| `npm run build` | Build extension (esbuild) + webview (Vite) |
| `npm run watch:extension` | Rebuild `dist/extension.js` on save |
| `npm run watch:webview` | Rebuild webview on save |
| `npm run typecheck` | `tsc --noEmit` for both projects |
| `npm run package` | Build + `vsce package` → `claude-coder-0.0.3.vsix` |

### SDK smoke tests

Verify your API key + SDK install end-to-end without launching the editor:

```bash
ANTHROPIC_API_KEY=sk-ant-... node scripts/e2e-runner-smoke.mjs --mode=agent
ANTHROPIC_API_KEY=sk-ant-... node scripts/e2e-runner-smoke.mjs --mode=plan
ANTHROPIC_API_KEY=sk-ant-... node scripts/e2e-runner-smoke.mjs --mode=ask
ANTHROPIC_API_KEY=sk-ant-... node scripts/e2e-runner-smoke.mjs --mode=multitask
ANTHROPIC_API_KEY=sk-ant-... node scripts/e2e-runner-smoke.mjs --mode=plan-build
ANTHROPIC_API_KEY=sk-ant-... node scripts/e2e-runner-smoke.mjs --mode=perm-readonly
node scripts/indexer-smoke.mjs
```

- `--mode=agent` does Read + Edit on a temp file and asserts the file changed.
- `--mode=plan` runs the two-turn protocol: turn 1 must contain `1.` and `2.`
  (questions) and end with `?`; turn 2 must produce a numbered plan with ≥3
  items and leave the file unchanged.
- `--mode=ask` asserts NO `Edit`/`Write`/`Bash` were called.
- `--mode=multitask` asserts ≥1 `Agent` tool dispatch and that nested
  messages carry `parent_tool_use_id`.
- `--mode=plan-build` runs Plan → answer → simulated `acceptPlan` with
  `acceptEdits`; asserts Edit fired without a `canUseTool` round-trip.
- `--mode=perm-readonly` runs Agent's system prompt with a tool list
  intersected to the read-only set; asserts no mutations were attempted.
- `indexer-smoke.mjs` is a Node-only sanity check for the indexer's
  walking, `.gitignore` exclusion, and ~10 KB cap.

Cost: ~$0.02–0.20 per run.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeCoder.model` | `claude-sonnet-4-5` | Model to use |
| `claudeCoder.maxTurns` | `50` | Max agent turns per query |
| `claudeCoder.permissionMode` | `default` | `default` (canUseTool prompts), `acceptEdits` (auto-accept file edits), `bypassPermissions` (no prompts). Workspace baseline; per-run pill overrides. |
| `claudeCoder.systemPromptOverride` | `""` | Optional custom system prompt — when set, it replaces (rather than augments) the per-mode prompt + indexer + project context. |
| `claudeCoder.allowedTools` | `["Read","Write","Edit","Bash","Glob","Grep","WebSearch","WebFetch"]` | Tools the agent can call (intersected with the active mode's tool set, then optionally with read-only for the per-run pill). |

## Commands

- `Claude Coder: Focus Chat` — <kbd>⌘L</kbd> / <kbd>Ctrl+L</kbd>
- `Claude Coder: New Session` — clears the saved `session_id`
- `Claude Coder: Set Anthropic API Key…` — store key in `SecretStorage`
- `Claude Coder: Clear Anthropic API Key`
- `Claude Coder: Stop` — abort the in-flight agent run
- `Claude Coder: Open Current Plan in Editor` — mirror the plan to a
  read-only `claude-coder-plan:` virtual document

## Architecture

```
extension host (Node)                       webview (React + Vite)
─────────────────────                       ──────────────────────
extension.ts                                App.tsx
  ├─ ChatViewProvider                         ├─ Composer (+ menu, mode pill,
  │    ├─ AgentRunner ─→ Agent SDK            │             perm pill, model,
  │    │    ├─ modes.ts (Agent/Plan/Ask/      │             mic, send)
  │    │    │              Multitask/Debug)   ├─ ModePicker popover
  │    │    ├─ contextLoader (CLAUDE.md…)     ├─ PermPill (Read-only / Ask /
  │    │    ├─ workspaceIndexer (file tree    │             Auto-approve)
  │    │    │      + key-file excerpts,       ├─ PermissionsPanel (lock icon)
  │    │    │      .gitignore-aware)          ├─ ContextBar (% indicator)
  │    │    ├─ tokenTracker (usage→ctxBar)    ├─ PlanPanel (sidebar takeover)
  │    │    ├─ ToolApprovalBridge ─⇆─→  ApprovalDialog + DiffPreview
  │    │    └─ SessionStore                   ├─ BuildDialog (3-option)
  │    └─ SecretsStore                        ├─ SubagentWorkstream (nested
  ├─ PlanDocProvider (claude-coder-plan: URI) │      by parent_tool_use_id)
  ├─ debounced save listener → invalidate     └─ ToolUseBlock
  │      indexer cache                          (markdown render via marked)
  └─ openPlanInEditor command
```

The two sides share the typed message protocol in
[`src/util/messages.ts`](./src/util/messages.ts) — re-imported by the webview
via a relative path so a single source of truth defines every message.

System-prompt order each turn:
1. **CLAUDE.md / AGENTS.md / .cursorrules** (your curated guidance)
2. **Workspace tree + key-file excerpts** (from the indexer cache)
3. **Mode prompt** (Plan / Debug / Multitask / Ask)

This mirrors the priority you'd want: specific user instructions trump
auto-extracted hints, which trump the mode-default heuristics.

## Notes / known limitations

- The SDK ships an embedded `claude` runtime (~200 MB) so the packaged
  `.vsix` is ~62 MB.
- Multi-agent: workers stream in parallel and the UI keys them by
  `parent_tool_use_id` so output never bleeds between workers. They do **not**
  share the parent's context — pass each worker a self-contained prompt.
- Mic is a placeholder (disabled, "coming soon"). Image attachment, Models /
  Skills / MCP Servers menu items in the `+` menu are placeholders.
- Mode-switch mid-session: only the next turn's options change. The session
  is preserved (resume keeps history).
- Webview syntax highlighting is intentionally minimal (no Shiki) to keep
  the bundle small — markdown code blocks render as plain mono text.
- Plan view's "select text to add comments" affordance from Cursor is **not**
  yet implemented — the follow-up textarea works but text-selection-bound
  comments are stubbed.
- The indexer is `.gitignore`-aware via a small inline matcher (handles the
  common subset: literals, `*` wildcards, `/`-anchored, trailing-`/` dir-only,
  `!` negation). Edge-case rules may slip through.

## License

MIT.

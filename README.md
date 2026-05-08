# Claude Coder

A VS Code extension that brings agentic coding to the editor, powered by the
official [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).
Mirrors the visual language of the Claude Code CLI: off-black background,
Claude orange accent, mono-spaced tool cards, side-by-side diff approval.

![Claude Coder screenshot](./media/screenshot.png)

## What it does

- **Sidebar chat** in its own activity bar container.
- Streams `assistant`, `tool_use`, and `tool_result` events from the SDK
  in real time.
- **Approval-gated tools** — `Edit` / `Write` / `Bash` route through a
  `canUseTool` round-trip with a unified diff preview and Allow / Deny dialog.
  Read-only tools (`Read` / `Glob` / `Grep` / `WebSearch` / `WebFetch`) are
  pre-approved by default in `default` permission mode.
- **`@`-mention** workspace files via `vscode.workspace.findFiles`.
- **Slash commands**: `/help`, `/clear`, `/new`, `/resume`, `/cost`, `/model`.
- **Per-workspace session resume** — `session_id` is persisted in
  `workspaceState` and re-used on the next prompt; `New Session` clears it.
- **Stop button** wired to an `AbortController` passed into `query()`.
- **API key in `vscode.SecretStorage`** — never written to disk in plain text;
  prompted on first use.

## Install (from the .vsix)

```bash
# In VS Code or Cursor:
code --install-extension claude-coder-0.0.1.vsix
# Or: Command Palette → "Extensions: Install from VSIX…" → pick the file.
```

The packaged `.vsix` lives at the project root (`claude-coder-0.0.1.vsix`).

## First run

1. Click the Claude Coder icon in the activity bar (sidebar).
2. The empty-state shows **Set Anthropic API Key…** — click it (or run
   `Claude Coder: Set Anthropic API Key…` from the command palette).
3. Paste your `sk-ant-…` key. It is stored in VS Code's `SecretStorage`.
4. Type a prompt and press <kbd>Enter</kbd>. Try:
   - `read package.json and tell me what scripts are defined`
   - `add a CLI flag --verbose to src/main.ts and update tests`
   - `@README.md what's missing in this doc?`
   - `/help`

When Claude proposes an `Edit` or `Write`, you'll see a diff preview with
**Allow once** / **Deny…** buttons. Bash commands show the exact command to
be run.

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
| `npm run package` | Build + `vsce package` → `claude-coder-0.0.1.vsix` |

### SDK smoke test

Verify your API key + SDK install end-to-end without launching the editor:

```bash
ANTHROPIC_API_KEY=sk-ant-... node scripts/e2e-runner-smoke.mjs
```

This runs a real 1-prompt agent loop that does Read + Edit on a temp file
and asserts the file was changed correctly. Cost: ~$0.02.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeCoder.model` | `claude-sonnet-4-5` | Model to use |
| `claudeCoder.maxTurns` | `50` | Max agent turns per query |
| `claudeCoder.permissionMode` | `default` | `default` (canUseTool prompts), `acceptEdits` (auto-accept file edits), `bypassPermissions` (no prompts) |
| `claudeCoder.systemPromptOverride` | `""` | Optional custom system prompt |
| `claudeCoder.allowedTools` | `["Read","Write","Edit","Bash","Glob","Grep","WebSearch","WebFetch"]` | Tools the agent can call |

## Commands

- `Claude Coder: Focus Chat` — <kbd>⌘L</kbd> / <kbd>Ctrl+L</kbd>
- `Claude Coder: New Session` — clears the saved `session_id`
- `Claude Coder: Set Anthropic API Key…` — store key in `SecretStorage`
- `Claude Coder: Clear Anthropic API Key`
- `Claude Coder: Stop` — abort the in-flight agent run

## Architecture

```
extension host (Node)                webview (React + Vite)
─────────────────────                ──────────────────────
extension.ts                         App.tsx
  └─ ChatViewProvider                  ├─ Composer (@ + /)
       ├─ AgentRunner ─→ Agent SDK     ├─ MessageList
       │    ├─ ToolApprovalBridge ─⇆─→ ApprovalDialog + DiffPreview
       │    └─ SessionStore            └─ ToolUseBlock
       └─ SecretsStore                 (markdown render via marked)
```

The two sides share the typed message protocol in
[`src/util/messages.ts`](./src/util/messages.ts) — re-imported by the webview
via a relative path so a single source of truth defines every message.

## Notes / known limitations

- The SDK ships an embedded `claude` runtime (~200 MB) so the packaged
  `.vsix` is ~62 MB — that's the cost of carrying its own subprocess engine.
  This is the same model the official Claude Code extension uses.
- Plan-mode toggle, inline-edit code action, status bar item, and
  `CLAUDE.md` auto-load are listed as stretch goals in the build plan
  and are not yet wired up.
- The webview's syntax highlighting is intentionally minimal (no Shiki) to
  keep the bundle small — markdown code blocks render as plain mono text.

## License

MIT.

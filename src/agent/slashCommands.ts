/**
 * Slash-command registry. Mirrors the leaked Claude Code source's three-type
 * pattern (local / local-jsx / prompt) without copying any of its code:
 *   - local    : sync side-effect handler (e.g. /clear, /cost, /new)
 *   - local-jsx: posts an `openPanel` to the webview (e.g. /help, /permissions, /model)
 *   - prompt   : desugars to a templated prompt that gets sent to the agent
 *
 * Adding a new command:
 *   1. Append a `SlashCommand` entry below.
 *   2. (prompt) — write the build() function that returns the templated prompt.
 *   3. (local) — implement the run() handler with side effects.
 *   4. (local-jsx) — point at one of the existing PanelKind ids.
 *
 * Two prompts (/init, /review) are quoted from the public claude-code reference
 * repo cited in the iteration plan; both are free-text command instructions
 * (not source code), and they're tightened slightly for our environment.
 */

import * as vscode from "vscode";
import type { SlashCommandMeta, PanelKind } from "../util/messages";

export type SlashKind = "local" | "local-jsx" | "prompt";

export type SlashCtx = {
  /** Post a message back to the webview (info, transcriptCleared, …). */
  post: (msg: { type: string; [k: string]: unknown }) => void;
  /** Run the agent with a templated prompt (used by `prompt`-type commands). */
  runAgent: (prompt: string) => Promise<void>;
  /** Start a brand-new session (drops resume id + transcript). */
  newSession: () => Promise<void>;
  /** Stop any in-flight run. */
  stop: () => void;
  /** Get the last completed run's cost/duration (for /cost). */
  lastResult: () => { cost?: number; ms?: number } | null;
  /** Workspace root path (for messages, not required for execution). */
  cwd: () => string | null;
  /** Active session id, if any. */
  sessionId: () => string | null;
};

export type SlashCommand =
  | {
      type: "local";
      name: string;
      desc: string;
      run: (args: string, ctx: SlashCtx) => Promise<void> | void;
    }
  | {
      type: "local-jsx";
      name: string;
      desc: string;
      panel: PanelKind;
    }
  | {
      type: "prompt";
      name: string;
      desc: string;
      build: (args: string) => string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Prompt templates
// ─────────────────────────────────────────────────────────────────────────────

const INIT_PROMPT = `Please analyze this codebase and create a CLAUDE.md file at the workspace root, which will be loaded into every future Craig Code session in this repo.

What to add:
1. Commands that will be commonly used: how to build, lint, run tests (and a single test). Include the actual scripts from package.json / Makefile / etc., not generic placeholders.
2. High-level architecture: the "big picture" that requires reading multiple files to grasp. Module boundaries, key data flows, important conventions.

Usage notes:
- If CLAUDE.md already exists, propose specific diffs and explain why each change improves it. Do not silently overwrite.
- Do not repeat yourself, do not include obvious instructions like "Provide helpful error messages" or "Write unit tests".
- Avoid listing every component or file structure — that's discoverable.
- Don't include generic development practices.
- If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), include the important parts.
- If there is a README.md, include the important parts.
- Do NOT make up sections like "Common Development Tasks", "Tips for Development", or "Support and Documentation" unless their content was found in files you read.
- Be sure to prefix the file with:

\`\`\`
# CLAUDE.md

This file provides guidance to Craig Code when working with code in this repository.
\`\`\``;

const REVIEW_PROMPT = (args: string) => `You are an expert code reviewer. Follow these steps:

1. If no PR number is provided in the args, run \`gh pr list\` to show open PRs.
2. If a PR number is provided, run \`gh pr view <number>\` to get PR details.
3. Run \`gh pr diff <number>\` to get the diff.
4. Analyze the changes and provide a thorough code review that includes:
   - Overview of what the PR does
   - Analysis of code quality and style
   - Specific suggestions for improvements
   - Any potential issues or risks

Keep your review concise but thorough. Focus on:
- Code correctness
- Following project conventions
- Performance implications
- Test coverage
- Security considerations

Format your review with clear sections and bullet points.

PR number: ${args.trim() || "(none provided — list open PRs first)"}`;

const SECURITY_REVIEW_PROMPT = `You are a senior application-security engineer. Audit the recently changed code in this workspace for security issues.

Steps:
1. Run \`git status\` and \`git diff HEAD~5...HEAD\` (or the working tree if uncommitted) to find recently modified files.
2. Read each changed file and surrounding context (entry points, auth, data flow).
3. Flag concrete issues with severity (Critical / High / Medium / Low) and a one-line rationale.

Look for:
- Unsanitized input flowing into shell, SQL, file paths, or HTML
- Missing auth/authz checks on new endpoints
- Hard-coded secrets, weak crypto, insecure defaults
- Path traversal, SSRF, ReDoS, prototype pollution, deserialization
- Logging of sensitive data
- Race conditions or TOCTOU on filesystem / auth / billing flows

Output a single Markdown table: file:line · severity · issue · suggested fix.

If you find nothing concrete, say so explicitly — do not invent issues.`;

const COMPACT_PROMPT = (args: string) => `Summarize the conversation so far in <= 200 tokens. Preserve:
- The user's high-level goal
- Open todos and decisions made
- Any failing tests, errors, or blockers
- Files we've touched (paths only, no diffs)

${args.trim() ? `Additional focus from the user: ${args.trim()}\n\n` : ""}Output ONLY the summary text, no preamble. This summary will replace the rest of the conversation in context.`;

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export const SLASH_COMMANDS: SlashCommand[] = [
  // local-jsx (pure UI)
  { type: "local-jsx", name: "help", desc: "Show available commands", panel: "help" },
  { type: "local-jsx", name: "permissions", desc: "Open the permissions panel", panel: "permissions" },
  { type: "local-jsx", name: "model", desc: "Pick a model", panel: "model" },

  // local (side-effects in extension/webview)
  {
    type: "local",
    name: "clear",
    desc: "Clear the conversation",
    run: (_args, ctx) => {
      ctx.post({ type: "transcriptCleared" });
    },
  },
  {
    type: "local",
    name: "new",
    desc: "Start a new session",
    run: async (_args, ctx) => {
      await ctx.newSession();
    },
  },
  {
    type: "local",
    name: "resume",
    desc: "Resume the last saved session",
    run: (_args, ctx) => {
      const sid = ctx.sessionId();
      ctx.post({
        type: "info",
        text: sid
          ? `Will resume session ${sid.slice(0, 8)} on the next message.`
          : "No saved session to resume.",
      });
    },
  },
  {
    type: "local",
    name: "cost",
    desc: "Show last run cost & duration",
    run: (_args, ctx) => {
      const r = ctx.lastResult();
      ctx.post({
        type: "info",
        text: r
          ? `Last run · cost $${(r.cost ?? 0).toFixed(4)} · ${(r.ms ?? 0)}ms`
          : "No completed runs yet.",
      });
    },
  },
  {
    type: "local",
    name: "stop",
    desc: "Stop the running agent",
    run: (_args, ctx) => {
      ctx.stop();
    },
  },

  // prompt (desugar into a normal agent run)
  {
    type: "prompt",
    name: "init",
    desc: "Initialize a CLAUDE.md for this repo",
    build: () => INIT_PROMPT,
  },
  {
    type: "prompt",
    name: "review",
    desc: "Review a pull request (args: PR number)",
    build: (args) => REVIEW_PROMPT(args),
  },
  {
    type: "prompt",
    name: "security-review",
    desc: "Audit recent changes for security issues",
    build: () => SECURITY_REVIEW_PROMPT,
  },
  {
    type: "prompt",
    name: "compact",
    desc: "Summarize the conversation in <= 200 tokens",
    build: (args) => COMPACT_PROMPT(args),
  },
];

export function findSlash(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((c) => c.name === name);
}

/** Lightweight metadata for the webview popup + HelpPanel. */
export function slashCommandsMeta(): SlashCommandMeta[] {
  return SLASH_COMMANDS.map((c) => ({
    name: c.name,
    desc: c.desc,
    kind: c.type,
  }));
}

/** Convenience: best-effort URI opener used by the help panel. */
export function openExternalDocsForSlash(_name: string): void {
  void vscode.commands.executeCommand("noop");
}

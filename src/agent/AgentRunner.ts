import * as vscode from "vscode";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" };
import type { ChatViewProvider } from "../chat/ChatViewProvider";

type QueryFn = (params: {
  prompt: string | AsyncIterable<unknown>;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

let cachedQuery: QueryFn | null = null;
async function loadQuery(): Promise<QueryFn> {
  if (cachedQuery) return cachedQuery;
  const mod = (await import("@anthropic-ai/claude-agent-sdk")) as { query: QueryFn };
  cachedQuery = mod.query;
  return cachedQuery;
}
import type { SecretsStore } from "../auth/secrets";
import type { SessionStore } from "./sessionStore";
import { ToolApprovalBridge } from "./toolApproval";
import type { StreamItem } from "../util/messages";
import { MODE_DEFS, type Mode } from "./modes";
import { loadProjectContext } from "./contextLoader";
import { TokenTracker } from "./tokenTracker";

let nextId = 1;
const id = () => `m_${nextId++}`;

type RunOptions = {
  prompt: string;
  resumeSessionId?: string | null;
  mode?: Mode;
};

export class AgentRunner {
  private abortController: AbortController | null = null;
  private currentSessionId: string | null = null;
  public approval: ToolApprovalBridge;
  private currentMode: Mode = "agent";
  private tokens = new TokenTracker();

  constructor(
    private readonly provider: ChatViewProvider,
    private readonly secrets: SecretsStore,
    private readonly sessionStore: SessionStore,
  ) {
    this.approval = new ToolApprovalBridge(provider, sessionStore.workspaceRoot());
  }

  isRunning(): boolean {
    return this.abortController !== null;
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.approval.cancelAll();
    this.provider.post({ type: "running", running: false });
  }

  sessionId(): string | null {
    return this.currentSessionId ?? this.sessionStore.get();
  }

  mode(): Mode {
    return this.currentMode;
  }

  setMode(m: Mode): void {
    this.currentMode = m;
    this.provider.post({ type: "modeChanged", mode: m });
  }

  async newSession(): Promise<void> {
    this.stop();
    this.currentSessionId = null;
    this.tokens.reset();
    this.provider.post({ type: "contextUsage", usage: this.tokens.snapshot() });
    await this.sessionStore.clear();
    this.provider.post({ type: "session", sessionId: null });
    this.provider.post({ type: "transcriptCleared" });
  }

  async run({ prompt, resumeSessionId, mode }: RunOptions): Promise<void> {
    if (this.isRunning()) {
      this.provider.post({
        type: "stream",
        item: { kind: "error", id: id(), text: "An agent run is already in progress. Stop it first." },
      });
      return;
    }

    const apiKey = await this.secrets.get();
    if (!apiKey) {
      this.provider.post({
        type: "stream",
        item: {
          kind: "error",
          id: id(),
          text: "No Anthropic API key set. Run `Claude Coder: Set Anthropic API Key…` from the command palette.",
        },
      });
      return;
    }

    if (mode) this.currentMode = mode;
    const activeMode = this.currentMode;
    const def = MODE_DEFS[activeMode];

    const cfg = vscode.workspace.getConfiguration("claudeCoder");
    const model = cfg.get<string>("model", "claude-sonnet-4-5");
    const maxTurns = cfg.get<number>("maxTurns", 50);
    const permissionMode = cfg.get<string>("permissionMode", "default") as
      | "default"
      | "acceptEdits"
      | "bypassPermissions";
    const systemPromptOverride = cfg.get<string>("systemPromptOverride", "").trim();
    const userTools = cfg.get<string[]>("allowedTools", [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch",
    ]);

    // Intersect mode tools with user-enabled tools, preserving any mode-only
    // tools (e.g. Agent in Multitask) that aren't in the user's enabled set.
    const modeOnly = def.tools.filter((t) => !userTools.includes(t));
    const enabledTools = [...userTools.filter((t) => def.tools.includes(t)), ...modeOnly];

    // Pre-approve list — read-only set in plan/ask, gated edits in agent/etc.
    const preApproved =
      permissionMode === "default"
        ? enabledTools.filter((t) => def.preApproved.includes(t))
        : enabledTools;

    const cwd = this.sessionStore.workspaceRoot();
    const resume = resumeSessionId ?? this.sessionStore.get() ?? undefined;

    this.tokens.setModel(model);

    // CLAUDE.md / AGENTS.md / .cursorrules
    const ctx = await loadProjectContext(cwd);
    if (ctx.loaded.length > 0) {
      const summary = ctx.loaded
        .map((f) => `${f.name} (${(f.bytes / 1024).toFixed(1)} KB)`)
        .join(", ");
      this.provider.post({
        type: "stream",
        item: { kind: "system", id: id(), text: `Loaded ${summary}` },
      });
    }

    const appended = [def.prompt, ctx.combined].filter(Boolean).join("\n\n");

    this.abortController = new AbortController();
    this.approval = new ToolApprovalBridge(this.provider, cwd);
    this.provider.setApprovalBridge(this.approval);
    this.provider.post({ type: "running", running: true });
    this.provider.post({
      type: "stream",
      item: { kind: "user", id: id(), text: prompt, mode: activeMode },
    });

    const useApproval = def.useApproval && permissionMode === "default";

    const opts: Options = {
      cwd: cwd ?? undefined,
      model,
      maxTurns,
      allowedTools: preApproved,
      // tools acts as a hard whitelist for the SDK; mode tools list defines availability.
      // (newer SDK wants `disallowedTools`/`allowedTools` only, but `tools` is still honored.)
      // Keeping enabledTools here preserves prior behaviour without surprising the SDK.
      tools: enabledTools,
      permissionMode,
      abortController: this.abortController,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        CLAUDE_AGENT_SDK_CLIENT_APP: "claude-coder/0.0.2",
      } as Record<string, string | undefined>,
      ...(systemPromptOverride
        ? { systemPrompt: systemPromptOverride }
        : appended
          ? { appendSystemPrompt: appended }
          : {}),
      ...(def.agents ? { agents: def.agents } : {}),
      ...(useApproval ? { canUseTool: this.approval.canUseTool } : {}),
      ...(resume ? { resume } : {}),
    };

    try {
      const query = await loadQuery();
      for await (const m of query({ prompt, options: opts })) {
        await this.handleMessage(m);
      }
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : String(err);
      const aborted =
        text.includes("AbortError") ||
        text.includes("aborted") ||
        this.abortController?.signal.aborted === true;
      this.provider.post({
        type: "stream",
        item: { kind: aborted ? "system" : "error", id: id(), text: aborted ? "Stopped." : `Error: ${text}` },
      });
    } finally {
      this.abortController = null;
      this.provider.post({ type: "running", running: false });
      this.provider.post({ type: "contextUsage", usage: this.tokens.snapshot() });
    }
  }

  private async handleMessage(m: SDKMessage): Promise<void> {
    switch (m.type) {
      case "system": {
        if ((m as { subtype?: string }).subtype === "init") {
          const sysInit = m as unknown as {
            session_id: string;
            model: string;
            cwd: string;
            tools: string[];
            permissionMode: string;
          };
          this.currentSessionId = sysInit.session_id;
          await this.sessionStore.save(sysInit.session_id);
          this.provider.post({ type: "session", sessionId: sysInit.session_id });
          this.provider.post({
            type: "stream",
            item: {
              kind: "system",
              id: id(),
              text: `Session ${sysInit.session_id.slice(0, 8)} · ${sysInit.model} · ${this.currentMode} mode`,
            },
          });
        }
        break;
      }
      case "assistant": {
        const am = m as unknown as {
          message: { content: unknown[]; id?: string; usage?: unknown };
          parent_tool_use_id: string | null;
        };
        const parentId = am.parent_tool_use_id ?? null;
        // Per-turn streamed usage (cumulative across the assistant message).
        const usage = (am.message as { usage?: unknown }).usage as
          | {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number | null;
              cache_creation_input_tokens?: number | null;
            }
          | undefined;
        if (usage) this.tokens.ingestUsage(usage);

        for (const block of am.message.content) {
          const b = block as { type: string } & Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
            this.provider.post({
              type: "stream",
              item: {
                kind: "assistant_text",
                id: id(),
                text: b.text,
                messageId: am.message.id,
                parentToolUseId: parentId,
              },
            });
          } else if (b.type === "tool_use") {
            const item: StreamItem = {
              kind: "tool_use",
              id: id(),
              toolUseId: String(b.id),
              name: String(b.name),
              input: (b.input as Record<string, unknown>) ?? {},
              parentToolUseId: parentId,
            };
            this.provider.post({ type: "stream", item });
          }
        }
        break;
      }
      case "user": {
        const um = m as unknown as {
          message: { content: unknown };
          parent_tool_use_id?: string | null;
        };
        const parentId = um.parent_tool_use_id ?? null;
        const content = um.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type: string } & Record<string, unknown>;
            if (b.type === "tool_result") {
              this.provider.post({
                type: "stream",
                item: {
                  kind: "tool_result",
                  id: id(),
                  toolUseId: String(b.tool_use_id),
                  content: b.content,
                  isError: Boolean(b.is_error),
                  parentToolUseId: parentId,
                },
              });
            }
          }
        }
        break;
      }
      case "result": {
        const r = m as unknown as {
          subtype: string;
          result?: string;
          total_cost_usd?: number;
          duration_ms?: number;
          session_id: string;
          usage?: unknown;
        };
        const success = r.subtype === "success";
        this.currentSessionId = r.session_id;
        await this.sessionStore.save(r.session_id);
        // Result usage is cumulative for the whole turn (authoritative).
        this.tokens.ingestResultUsage(
          r.usage as
            | {
                input_tokens?: number;
                output_tokens?: number;
                cache_read_input_tokens?: number | null;
                cache_creation_input_tokens?: number | null;
              }
            | undefined,
        );
        this.provider.post({ type: "contextUsage", usage: this.tokens.snapshot() });
        this.provider.post({
          type: "stream",
          item: {
            kind: "result",
            id: id(),
            success,
            text: r.result ?? r.subtype,
            totalCostUsd: r.total_cost_usd,
            durationMs: r.duration_ms,
            sessionId: r.session_id,
          },
        });
        break;
      }
      default:
        break;
    }
  }
}

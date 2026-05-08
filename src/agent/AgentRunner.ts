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

let nextId = 1;
const id = () => `m_${nextId++}`;

type RunOptions = {
  prompt: string;
  resumeSessionId?: string | null;
};

export class AgentRunner {
  private abortController: AbortController | null = null;
  private currentSessionId: string | null = null;
  public approval: ToolApprovalBridge;

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

  async newSession(): Promise<void> {
    this.stop();
    this.currentSessionId = null;
    await this.sessionStore.clear();
    this.provider.post({ type: "session", sessionId: null });
    this.provider.post({ type: "transcriptCleared" });
  }

  async run({ prompt, resumeSessionId }: RunOptions): Promise<void> {
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

    const cfg = vscode.workspace.getConfiguration("claudeCoder");
    const model = cfg.get<string>("model", "claude-sonnet-4-5");
    const maxTurns = cfg.get<number>("maxTurns", 50);
    const permissionMode = cfg.get<string>("permissionMode", "default") as
      | "default"
      | "acceptEdits"
      | "bypassPermissions";
    const systemPromptOverride = cfg.get<string>("systemPromptOverride", "").trim();
    // The full set of tools available to Claude.
    const enabledTools = cfg.get<string[]>("allowedTools", [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch",
    ]);
    // In `default` permission mode, anything in `allowedTools` is pre-approved
    // (no canUseTool prompt). Pre-approve safe read/search tools, gate
    // mutating ones through the approval bridge.
    const SAFE = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"]);
    const preApproved =
      permissionMode === "default"
        ? enabledTools.filter((t) => SAFE.has(t))
        : enabledTools;

    const cwd = this.sessionStore.workspaceRoot();
    const resume = resumeSessionId ?? this.sessionStore.get() ?? undefined;

    this.abortController = new AbortController();
    this.approval = new ToolApprovalBridge(this.provider, cwd);
    this.provider.setApprovalBridge(this.approval);
    this.provider.post({ type: "running", running: true });
    this.provider.post({ type: "stream", item: { kind: "user", id: id(), text: prompt } });

    const opts: Options = {
      cwd: cwd ?? undefined,
      model,
      maxTurns,
      allowedTools: preApproved,
      tools: enabledTools,
      permissionMode,
      abortController: this.abortController,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        CLAUDE_AGENT_SDK_CLIENT_APP: "claude-coder/0.0.1",
      } as Record<string, string | undefined>,
      ...(systemPromptOverride ? { systemPrompt: systemPromptOverride } : {}),
      ...(permissionMode === "default" ? { canUseTool: this.approval.canUseTool } : {}),
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
              text: `Session ${sysInit.session_id.slice(0, 8)} · ${sysInit.model} · mode=${sysInit.permissionMode}`,
            },
          });
        }
        break;
      }
      case "assistant": {
        const am = m as unknown as {
          message: { content: unknown[]; id?: string };
          parent_tool_use_id: string | null;
        };
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
              },
            });
          } else if (b.type === "tool_use") {
            const item: StreamItem = {
              kind: "tool_use",
              id: id(),
              toolUseId: String(b.id),
              name: String(b.name),
              input: (b.input as Record<string, unknown>) ?? {},
            };
            this.provider.post({ type: "stream", item });
          }
        }
        break;
      }
      case "user": {
        const um = m as unknown as { message: { content: unknown } };
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
          result: string;
          total_cost_usd?: number;
          duration_ms?: number;
          session_id: string;
        };
        const success = r.subtype === "success";
        this.currentSessionId = r.session_id;
        await this.sessionStore.save(r.session_id);
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

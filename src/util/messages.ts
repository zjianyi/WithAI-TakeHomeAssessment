/**
 * Typed protocol shared between the extension host and the webview.
 * Both sides import this file (the webview re-imports it via a relative path
 * to keep a single source of truth for the message shapes).
 */

export type Mode = "agent" | "plan" | "ask" | "multitask" | "debug";

/**
 * Per-run permission override. Orthogonal to Mode:
 *   - "default":     normal canUseTool gating on Edit/Write/Bash
 *   - "acceptEdits": SDK auto-approves edits (no prompts)
 *   - "readOnly":    intersect mode tool list with READ_ONLY_TOOLS for this run
 */
export type PermissionOverride = "default" | "acceptEdits" | "readOnly";

export type WorkspaceFile = {
  path: string;
  rel: string;
};

export type ApprovalRequestPayload = {
  id: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  diff?: string;
  filePath?: string;
};

export type ContextUsage = {
  inputTokens: number;
  outputTokens: number;
  contextLimit: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  lastTurnInput: number;
  lastTurnOutput: number;
};

export type StreamItem =
  | { kind: "user"; text: string; id: string; mode?: Mode }
  | {
      kind: "assistant_text";
      text: string;
      id: string;
      messageId?: string;
      parentToolUseId?: string | null;
      /** The mode that was active when this text was produced (used by Plan-view extraction). */
      mode?: Mode;
    }
  | {
      kind: "tool_use";
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      parentToolUseId?: string | null;
    }
  | {
      kind: "tool_result";
      id: string;
      toolUseId: string;
      content: unknown;
      isError?: boolean;
      parentToolUseId?: string | null;
    }
  | { kind: "system"; id: string; text: string }
  | { kind: "error"; id: string; text: string }
  | {
      kind: "result";
      id: string;
      success: boolean;
      text: string;
      totalCostUsd?: number;
      durationMs?: number;
      sessionId?: string;
    };

export type PermissionBaseline = {
  /** SDK permissionMode; only "default" or "acceptEdits" can be a baseline. */
  permissionMode: "default" | "acceptEdits";
  /** Tool allowlist persisted to workspace settings. */
  allowedTools: string[];
};

export type ExtToWebviewMessage =
  | { type: "ready" }
  | {
      type: "init";
      hasApiKey: boolean;
      model: string;
      permissionMode: string;
      cwd: string | null;
      sessionId: string | null;
      mode: Mode;
      allowedTools: string[];
    }
  | { type: "stream"; item: StreamItem }
  | { type: "running"; running: boolean }
  | { type: "approval-request"; payload: ApprovalRequestPayload }
  | { type: "approval-cancelled"; id: string }
  | { type: "files"; query: string; files: WorkspaceFile[] }
  | { type: "session"; sessionId: string | null }
  | { type: "transcriptCleared" }
  | { type: "info"; text: string }
  | { type: "contextUsage"; usage: ContextUsage }
  | { type: "modeChanged"; mode: Mode }
  | { type: "permissionBaseline"; baseline: PermissionBaseline };

export type WebviewToExtMessage =
  | { type: "webviewReady" }
  | { type: "send"; text: string; mode?: Mode; permissionModeOverride?: PermissionOverride }
  | { type: "stop" }
  | {
      type: "approval-response";
      id: string;
      result: { behavior: "allow" } | { behavior: "deny"; message: string };
    }
  | { type: "filesQuery"; query: string }
  | { type: "newSession" }
  | { type: "setApiKey" }
  | { type: "openFile"; path: string }
  | { type: "openExternal"; url: string }
  | { type: "setMode"; mode: Mode }
  | { type: "setModel"; model: string }
  | {
      type: "acceptPlan";
      permissionModeOverride: "acceptEdits" | "default";
      followUp?: string;
    }
  | { type: "openPlanInEditor"; content: string }
  | { type: "setPermissionBaseline"; baseline: PermissionBaseline };

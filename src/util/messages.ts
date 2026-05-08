/**
 * Typed protocol shared between the extension host and the webview.
 * Both sides import this file (the webview re-imports it via a relative path
 * to keep a single source of truth for the message shapes).
 */

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

export type StreamItem =
  | { kind: "user"; text: string; id: string }
  | { kind: "assistant_text"; text: string; id: string; messageId?: string }
  | {
      kind: "tool_use";
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      kind: "tool_result";
      id: string;
      toolUseId: string;
      content: unknown;
      isError?: boolean;
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

export type ExtToWebviewMessage =
  | { type: "ready" }
  | {
      type: "init";
      hasApiKey: boolean;
      model: string;
      permissionMode: string;
      cwd: string | null;
      sessionId: string | null;
    }
  | { type: "stream"; item: StreamItem }
  | { type: "running"; running: boolean }
  | { type: "approval-request"; payload: ApprovalRequestPayload }
  | { type: "approval-cancelled"; id: string }
  | { type: "files"; query: string; files: WorkspaceFile[] }
  | { type: "session"; sessionId: string | null }
  | { type: "transcriptCleared" }
  | { type: "info"; text: string };

export type WebviewToExtMessage =
  | { type: "webviewReady" }
  | { type: "send"; text: string }
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
  | { type: "openExternal"; url: string };

import React, { useEffect, useMemo, useRef, useState } from "react";
import { on, send } from "./lib/vscodeApi";
import type {
  ApprovalRequestPayload,
  ContextUsage,
  Mode,
  StreamItem,
} from "../../src/util/messages";
import { Welcome } from "./components/Welcome";
import { ToolUseBlock } from "./components/ToolUseBlock";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { Markdown } from "./components/Markdown";
import { Composer } from "./components/Composer";
import { ContextBar } from "./components/ContextBar";
import { SubagentWorkstream } from "./components/SubagentWorkstream";

type InitState = {
  hasApiKey: boolean;
  model: string;
  permissionMode: string;
  cwd: string | null;
  sessionId: string | null;
  mode: Mode;
};

type AnyItem =
  | { kind: "stream"; item: StreamItem }
  | { kind: "approval"; payload: ApprovalRequestPayload };

export function App() {
  const [init, setInit] = useState<InitState>({
    hasApiKey: false,
    model: "claude-sonnet-4-5",
    permissionMode: "default",
    cwd: null,
    sessionId: null,
    mode: "agent",
  });
  const [items, setItems] = useState<AnyItem[]>([]);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ cost?: number; ms?: number } | null>(null);
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const collapsed = useMemo(() => collapse(items), [items]);

  useEffect(() => {
    const off = on((m) => {
      if (m.type === "init") {
        setInit({
          hasApiKey: m.hasApiKey,
          model: m.model,
          permissionMode: m.permissionMode,
          cwd: m.cwd,
          sessionId: m.sessionId,
          mode: m.mode,
        });
      } else if (m.type === "stream") {
        if (m.item.kind === "result") {
          setLastResult({ cost: m.item.totalCostUsd, ms: m.item.durationMs });
        }
        setItems((prev) => [...prev, { kind: "stream", item: m.item }]);
      } else if (m.type === "running") {
        setRunning(m.running);
      } else if (m.type === "approval-request") {
        setItems((prev) => [...prev, { kind: "approval", payload: m.payload }]);
      } else if (m.type === "approval-cancelled") {
        setItems((prev) => prev.filter((x) => !(x.kind === "approval" && x.payload.id === m.id)));
      } else if (m.type === "session") {
        setInit((s) => ({ ...s, sessionId: m.sessionId }));
      } else if (m.type === "transcriptCleared") {
        setItems([]);
        setLastResult(null);
        setUsage(null);
      } else if (m.type === "info") {
        setItems((prev) => [
          ...prev,
          { kind: "stream", item: { kind: "system", id: `i_${Date.now()}`, text: m.text } },
        ]);
      } else if (m.type === "contextUsage") {
        setUsage(m.usage);
      } else if (m.type === "modeChanged") {
        setInit((s) => ({ ...s, mode: m.mode }));
      }
    });
    send({ type: "webviewReady" });
    return off;
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  function handleSlash(cmd: string): boolean {
    switch (cmd) {
      case "clear":
        setItems([]);
        return true;
      case "new":
        send({ type: "newSession" });
        return true;
      case "resume":
        setItems((prev) => [
          ...prev,
          {
            kind: "stream",
            item: {
              kind: "system",
              id: `i_${Date.now()}`,
              text: init.sessionId
                ? `Will resume session ${init.sessionId.slice(0, 8)} on the next message.`
                : "No saved session to resume.",
            },
          },
        ]);
        return true;
      case "cost":
        setItems((prev) => [
          ...prev,
          {
            kind: "stream",
            item: {
              kind: "system",
              id: `i_${Date.now()}`,
              text: lastResult
                ? `Last run · cost $${(lastResult.cost ?? 0).toFixed(4)} · ${(lastResult.ms ?? 0)}ms`
                : "No completed runs yet.",
            },
          },
        ]);
        return true;
      case "model":
        setItems((prev) => [
          ...prev,
          {
            kind: "stream",
            item: { kind: "system", id: `i_${Date.now()}`, text: `Model: ${init.model}` },
          },
        ]);
        return true;
      case "help":
        setItems((prev) => [
          ...prev,
          {
            kind: "stream",
            item: {
              kind: "system",
              id: `i_${Date.now()}`,
              text:
                "Commands: /help /clear /new /resume /cost /model. " +
                "Type @ to mention a workspace file. Press Esc to stop a running agent. " +
                "Modes: click + to switch (Plan / Debug / Multitask / Ask / Agent).",
            },
          },
        ]);
        return true;
      default:
        return false;
    }
  }

  const sessionShort = init.sessionId ? init.sessionId.slice(0, 8) : null;

  return (
    <div className="app">
      <div className="miniheader">
        <span className="brand">
          <span className="mark">●</span>
          Claude Coder
        </span>
        {sessionShort && <span className="session">session {sessionShort}</span>}
        <span className="spacer" />
        <button
          className="iconbtn"
          title="New session"
          onClick={() => send({ type: "newSession" })}
        >
          ＋ new
        </button>
        {!init.hasApiKey && (
          <button
            className="iconbtn"
            title="Set API key"
            onClick={() => send({ type: "setApiKey" })}
          >
            set API key
          </button>
        )}
      </div>

      <div className="transcript" ref={transcriptRef}>
        {items.length === 0 && <Welcome hasApiKey={init.hasApiKey} />}
        {renderEntries(collapsed)}
      </div>

      <ContextBar usage={usage} />

      <Composer
        running={running}
        mode={init.mode}
        onModeChange={(m) => {
          setInit((s) => ({ ...s, mode: m }));
          send({ type: "setMode", mode: m });
        }}
        model={init.model}
        onModelChange={(m) => {
          setInit((s) => ({ ...s, model: m }));
          send({ type: "setModel", model: m });
        }}
        onSend={(t, mode) => send({ type: "send", text: t, mode })}
        onStop={() => send({ type: "stop" })}
        onSlash={handleSlash}
      />
    </div>
  );
}

export type CollapsedEntry =
  | { kind: "user"; id: string; text: string; mode?: Mode }
  | { kind: "assistant"; id: string; text: string; parentToolUseId?: string | null }
  | {
      kind: "tool";
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      result?: { content: unknown; isError?: boolean };
      parentToolUseId?: string | null;
    }
  | { kind: "system"; id: string; text: string }
  | { kind: "error"; id: string; text: string }
  | {
      kind: "result";
      id: string;
      success: boolean;
      text: string;
      cost?: number;
      ms?: number;
    }
  | { kind: "approval"; payload: ApprovalRequestPayload };

function collapse(items: AnyItem[]): CollapsedEntry[] {
  const out: CollapsedEntry[] = [];
  const toolByUseId = new Map<string, CollapsedEntry & { kind: "tool" }>();

  for (const it of items) {
    if (it.kind === "approval") {
      out.push({ kind: "approval", payload: it.payload });
      continue;
    }
    const m = it.item;
    if (m.kind === "user") out.push({ kind: "user", id: m.id, text: m.text, mode: m.mode });
    else if (m.kind === "assistant_text") {
      const last = out[out.length - 1];
      // Only fold streaming text into the previous assistant block if their
      // parent_tool_use_id matches — otherwise nested subagent output would
      // collapse into the parent's bubble.
      if (
        last &&
        last.kind === "assistant" &&
        (last.parentToolUseId ?? null) === (m.parentToolUseId ?? null)
      ) {
        last.text += m.text;
      } else {
        out.push({
          kind: "assistant",
          id: m.id,
          text: m.text,
          parentToolUseId: m.parentToolUseId ?? null,
        });
      }
    } else if (m.kind === "tool_use") {
      const e: CollapsedEntry = {
        kind: "tool",
        id: m.id,
        toolUseId: m.toolUseId,
        name: m.name,
        input: m.input,
        parentToolUseId: m.parentToolUseId ?? null,
      };
      toolByUseId.set(m.toolUseId, e as CollapsedEntry & { kind: "tool" });
      out.push(e);
    } else if (m.kind === "tool_result") {
      const t = toolByUseId.get(m.toolUseId);
      if (t) t.result = { content: m.content, isError: m.isError };
      else
        out.push({
          kind: "tool",
          id: m.id,
          toolUseId: m.toolUseId,
          name: "tool",
          input: {},
          result: { content: m.content, isError: m.isError },
          parentToolUseId: m.parentToolUseId ?? null,
        });
    } else if (m.kind === "system") out.push({ kind: "system", id: m.id, text: m.text });
    else if (m.kind === "error") out.push({ kind: "error", id: m.id, text: m.text });
    else if (m.kind === "result")
      out.push({
        kind: "result",
        id: m.id,
        success: m.success,
        text: m.text,
        cost: m.totalCostUsd,
        ms: m.durationMs,
      });
  }
  return out;
}

/**
 * Group entries: top-level entries render normally; entries with a
 * parentToolUseId render under the matching Agent tool block as a nested
 * subagent workstream (see SubagentWorkstream).
 */
function renderEntries(entries: CollapsedEntry[]): React.ReactNode[] {
  // Bucket child entries by parentToolUseId.
  const childrenByParent = new Map<string, CollapsedEntry[]>();
  for (const e of entries) {
    let parent: string | null = null;
    if (e.kind === "assistant") parent = e.parentToolUseId ?? null;
    else if (e.kind === "tool") parent = e.parentToolUseId ?? null;
    if (parent) {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent)!.push(e);
    }
  }

  const nodes: React.ReactNode[] = [];
  for (const e of entries) {
    // Skip child nodes — they render inside their parent's workstream.
    if (
      (e.kind === "assistant" && (e.parentToolUseId ?? null)) ||
      (e.kind === "tool" && (e.parentToolUseId ?? null))
    ) {
      continue;
    }
    if (e.kind === "tool" && e.name === "Agent") {
      const subId = e.toolUseId;
      const kids = childrenByParent.get(subId) ?? [];
      nodes.push(
        <SubagentWorkstream
          key={e.id}
          parentTool={e}
          entries={kids}
          renderEntry={renderEntry}
        />,
      );
      continue;
    }
    nodes.push(renderEntry(e));
  }
  return nodes;
}

export function renderEntry(e: CollapsedEntry): React.ReactNode {
  switch (e.kind) {
    case "user":
      return (
        <div key={e.id} className="msg user">
          <div className="label">
            you
            {e.mode && e.mode !== "agent" && (
              <span className="mode-tag">{e.mode}</span>
            )}
          </div>
          <div className="bubble">{e.text}</div>
        </div>
      );
    case "assistant":
      return (
        <div key={e.id} className="msg assistant">
          <span className="bullet">●</span>
          <Markdown text={e.text} />
        </div>
      );
    case "tool":
      return (
        <div key={e.id}>
          <ToolUseBlock name={e.name} input={e.input} result={e.result} />
        </div>
      );
    case "system":
      return (
        <div key={e.id} className="msg system">
          <span className="glyph">∴</span>
          {e.text}
        </div>
      );
    case "error":
      return (
        <div key={e.id} className="msg error">
          <span className="glyph">✗</span>
          {e.text}
        </div>
      );
    case "result":
      return (
        <div key={e.id} className="msg result">
          <span className={e.success ? "ok" : "err"}>{e.success ? "✓ done" : "✗ " + e.text}</span>
          {e.cost !== undefined && <span>cost ${e.cost.toFixed(4)}</span>}
          {e.ms !== undefined && <span>{e.ms}ms</span>}
        </div>
      );
    case "approval":
      return <ApprovalDialog key={e.payload.id} payload={e.payload} />;
  }
}

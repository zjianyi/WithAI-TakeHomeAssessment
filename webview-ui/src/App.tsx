import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { on, send } from "./lib/vscodeApi";
import type {
  ApprovalRequestPayload,
  ContextUsage,
  EffortLevel,
  Mode,
  PanelKind,
  PermissionBaseline,
  PermissionOverride,
  SlashCommandMeta,
  StreamItem,
} from "../../src/util/messages";
import { READ_ONLY_TOOL_NAMES } from "./util/toolSummary";
import { Welcome } from "./components/Welcome";
import { ToolUseBlock } from "./components/ToolUseBlock";
import { ExploreGroup } from "./components/ExploreGroup";
import { ThinkingBlock } from "./components/ThinkingBlock";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { Markdown } from "./components/Markdown";
import { Composer } from "./components/Composer";
import { SubagentWorkstream } from "./components/SubagentWorkstream";
import { PlanPanel } from "./components/PlanPanel";
import { PermissionsPanel } from "./components/PermissionsPanel";
import { HelpPanel } from "./components/HelpPanel";

type InitState = {
  hasApiKey: boolean;
  model: string;
  permissionMode: string;
  cwd: string | null;
  sessionId: string | null;
  mode: Mode;
  allowedTools: string[];
  effort: EffortLevel;
  thinkingEnabled: boolean;
  slashCommands: SlashCommandMeta[];
};

type AnyItem =
  | { kind: "stream"; item: StreamItem }
  | { kind: "approval"; payload: ApprovalRequestPayload };

type PlanView = "hidden" | "live" | "review";

/**
 * Heuristic: an assistant turn is a "clarifying questions" turn if it starts
 * with `1.` and contains a `2.` early on.
 */
function looksLikeQuestions(text: string): boolean {
  return /^\s*1\./.test(text) && /\n\s*2\./.test(text.slice(0, 800));
}

export function App() {
  const [init, setInit] = useState<InitState>({
    hasApiKey: false,
    model: "claude-sonnet-4-6",
    permissionMode: "default",
    cwd: null,
    sessionId: null,
    mode: "agent",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
    effort: "high",
    thinkingEnabled: true,
    slashCommands: [],
  });
  const [items, setItems] = useState<AnyItem[]>([]);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ cost?: number; ms?: number } | null>(null);
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [planContent, setPlanContent] = useState<string>("");
  const [planView, setPlanView] = useState<PlanView>("hidden");
  const [permPanelOpen, setPermPanelOpen] = useState(false);
  const [helpPanelOpen, setHelpPanelOpen] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // rAF batching refs — accumulate StreamItems between frames, flush together.
  const pendingItems = useRef<AnyItem[]>([]);
  const rafId = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafId.current = null;
    const batch = pendingItems.current;
    pendingItems.current = [];
    if (batch.length === 0) return;
    setItems((prev) => [...prev, ...batch]);
  }, []);

  function pushItem(item: AnyItem) {
    pendingItems.current.push(item);
    if (rafId.current === null) {
      rafId.current = requestAnimationFrame(flush);
    }
  }

  // Flush on unmount.
  useEffect(() => () => { if (rafId.current !== null) cancelAnimationFrame(rafId.current); }, [flush]);

  const collapsed = useMemo(() => collapse(items), [items]);

  const baseline: PermissionOverride =
    init.permissionMode === "acceptEdits" ? "acceptEdits" : "default";

  const permBaseline: PermissionBaseline = {
    permissionMode: init.permissionMode === "acceptEdits" ? "acceptEdits" : "default",
    allowedTools: init.allowedTools,
  };

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
          allowedTools: m.allowedTools,
          effort: m.effort,
          thinkingEnabled: m.thinkingEnabled,
          slashCommands: m.slashCommands,
        });
      } else if (m.type === "stream") {
        if (m.item.kind === "result") {
          setLastResult({ cost: m.item.totalCostUsd, ms: m.item.durationMs });
          setPlanView((prev) => (prev === "live" ? "review" : prev));
        }
        if (m.item.kind === "assistant_text" && m.item.mode === "plan") {
          const text = m.item.text;
          if (!looksLikeQuestions(text)) {
            setPlanContent((prev) => prev + text);
            setPlanView((prev) => (prev === "hidden" ? "live" : prev));
          }
        }
        if (m.item.kind === "user" && m.item.mode === "plan") {
          setPlanContent("");
          setPlanView("hidden");
        }
        pushItem({ kind: "stream", item: m.item });
      } else if (m.type === "running") {
        setRunning(m.running);
      } else if (m.type === "approval-request") {
        pushItem({ kind: "approval", payload: m.payload });
      } else if (m.type === "approval-cancelled") {
        setItems((prev) => prev.filter((x) => !(x.kind === "approval" && x.payload.id === m.id)));
      } else if (m.type === "session") {
        setInit((s) => ({ ...s, sessionId: m.sessionId }));
      } else if (m.type === "transcriptCleared") {
        // Flush any pending batch first so it doesn't land after the clear.
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
          pendingItems.current = [];
        }
        setItems([]);
        setLastResult(null);
        setUsage(null);
        setPlanContent("");
        setPlanView("hidden");
      } else if (m.type === "info") {
        pushItem({
          kind: "stream",
          item: { kind: "system", id: `i_${Date.now()}`, text: m.text },
        });
      } else if (m.type === "contextUsage") {
        setUsage(m.usage);
      } else if (m.type === "modeChanged") {
        setInit((s) => ({ ...s, mode: m.mode }));
        if (m.mode !== "plan") {
          setPlanContent("");
          setPlanView("hidden");
        }
      } else if (m.type === "permissionBaseline") {
        setInit((s) => ({
          ...s,
          permissionMode: m.baseline.permissionMode,
          allowedTools: m.baseline.allowedTools,
        }));
      } else if (m.type === "effortChanged") {
        setInit((s) => ({ ...s, effort: m.effort }));
      } else if (m.type === "thinkingChanged") {
        setInit((s) => ({ ...s, thinkingEnabled: m.enabled }));
      } else if (m.type === "openPanel") {
        const panel: PanelKind = m.panel;
        if (panel === "help") setHelpPanelOpen(true);
        else if (panel === "permissions") setPermPanelOpen(true);
        // "model" is handled inside Composer (which owns the menu state).
      }
    });
    send({ type: "webviewReady" });
    return off;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  /**
   * Routes a slash command to the extension dispatcher. The dispatcher decides
   * whether it's a local action (transcriptCleared/info), a panel open, or a
   * templated agent prompt. `/plan` stays webview-local because it just toggles
   * the existing PlanPanel state.
   */
  function runSlash(name: string, args: string) {
    if (name === "plan") {
      if (planContent) setPlanView("review");
      return;
    }
    send({ type: "runSlash", name, args });
  }

  const sessionShort = init.sessionId ? init.sessionId.slice(0, 8) : null;

  function handleSend(text: string, mode?: Mode, permission?: PermissionOverride) {
    send({ type: "send", text, mode, permissionModeOverride: permission });
  }

  function handleAcceptPlan(perm: "acceptEdits" | "default", followUp?: string) {
    send({ type: "acceptPlan", permissionModeOverride: perm, followUp });
    setPlanView("hidden");
  }

  function handleRefine(followUp?: string) {
    const text = followUp && followUp.trim().length > 0
      ? followUp
      : "Refine the plan based on the comments above.";
    send({ type: "send", text, mode: "plan" });
  }

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
          className={`iconbtn lockbtn${permPanelOpen ? " active" : ""}`}
          title="Permissions"
          aria-label="Open permissions panel"
          onClick={() => setPermPanelOpen((v) => !v)}
        >
          🔒
        </button>
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

      {planView !== "hidden" ? (
        <PlanPanel
          state={planView === "live" ? "live" : "review"}
          content={planContent}
          onBack={() => setPlanView("hidden")}
          onOpenInEditor={() => send({ type: "openPlanInEditor", content: planContent })}
          onBuild={(f) => handleAcceptPlan("acceptEdits", f)}
          onBuildSafe={(f) => handleAcceptPlan("default", f)}
          onRefine={handleRefine}
        />
      ) : (
        <div className="transcript" ref={transcriptRef}>
          {items.length === 0 && <Welcome hasApiKey={init.hasApiKey} />}
          {renderEntries(collapsed)}
          {init.mode === "plan" && planContent && !running && (
            <button
              className="plan-resume"
              onClick={() => setPlanView("review")}
              title="Re-open the plan view"
            >
              ↗ Open plan view ({planContent.length.toLocaleString()} chars)
            </button>
          )}
        </div>
      )}

      <PermissionsPanel
        open={permPanelOpen}
        baseline={permBaseline}
        onClose={() => setPermPanelOpen(false)}
        onSave={(b) => send({ type: "setPermissionBaseline", baseline: b })}
      />

      <HelpPanel
        open={helpPanelOpen}
        commands={init.slashCommands}
        onClose={() => setHelpPanelOpen(false)}
        onPick={(name) => runSlash(name, "")}
      />

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
        onSend={handleSend}
        onStop={() => send({ type: "stop" })}
        onRunSlash={runSlash}
        permissionBaseline={baseline}
        usage={usage}
        slashCommands={init.slashCommands}
        effort={init.effort}
        onEffortChange={(e) => {
          setInit((s) => ({ ...s, effort: e }));
          send({ type: "setEffort", effort: e });
        }}
        thinkingEnabled={init.thinkingEnabled}
        onThinkingChange={(on) => {
          setInit((s) => ({ ...s, thinkingEnabled: on }));
          send({ type: "setThinking", enabled: on });
        }}
        onAccountUsage={() => runSlash("cost", "")}
      />
    </div>
  );
}

// ─── Collapsed transcript types ───────────────────────────────────────────────

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
  | {
      /** A cluster of consecutive read-only tool calls. */
      kind: "explore_group";
      id: string;
      tools: {
        id: string;
        toolUseId: string;
        name: string;
        input: Record<string, unknown>;
        result?: { content: unknown; isError?: boolean };
      }[];
      parentToolUseId?: string | null;
    }
  | { kind: "thinking"; id: string; text: string; durationMs?: number }
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
  // Track the last explore_group entry so we can append matching tool_results.
  let currentGroup: (CollapsedEntry & { kind: "explore_group" }) | null = null;

  function closeGroup() {
    if (currentGroup) {
      out.push(currentGroup);
      currentGroup = null;
    }
  }

  for (const it of items) {
    if (it.kind === "approval") {
      closeGroup();
      out.push({ kind: "approval", payload: it.payload });
      continue;
    }
    const m = it.item;

    if (m.kind === "user") {
      closeGroup();
      out.push({ kind: "user", id: m.id, text: m.text, mode: m.mode });
    } else if (m.kind === "assistant_text") {
      closeGroup();
      const last = out[out.length - 1];
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
    } else if (m.kind === "thinking") {
      closeGroup();
      out.push({ kind: "thinking", id: m.id, text: m.text, durationMs: m.durationMs });
    } else if (m.kind === "tool_use") {
      const isReadOnly = READ_ONLY_TOOL_NAMES.has(m.name);
      const parentId = m.parentToolUseId ?? null;

      if (isReadOnly) {
        // If there's an active group for the same parent, append; otherwise start one.
        if (!currentGroup || (currentGroup.parentToolUseId ?? null) !== parentId) {
          closeGroup();
          currentGroup = {
            kind: "explore_group",
            id: m.id,
            tools: [],
            parentToolUseId: parentId,
          };
        }
        const entry = {
          id: m.id,
          toolUseId: m.toolUseId,
          name: m.name,
          input: m.input,
        };
        currentGroup.tools.push(entry);
        // Register so tool_result can hydrate it.
        toolByUseId.set(m.toolUseId, {
          kind: "tool",
          id: m.id,
          toolUseId: m.toolUseId,
          name: m.name,
          input: m.input,
          parentToolUseId: parentId,
        });
      } else {
        closeGroup();
        const e: CollapsedEntry = {
          kind: "tool",
          id: m.id,
          toolUseId: m.toolUseId,
          name: m.name,
          input: m.input,
          parentToolUseId: parentId,
        };
        toolByUseId.set(m.toolUseId, e as CollapsedEntry & { kind: "tool" });
        out.push(e);
      }
    } else if (m.kind === "tool_result") {
      // Find the matching entry in either the current group's tools or out[].
      const inGroup = currentGroup?.tools.find((t) => t.toolUseId === m.toolUseId);
      if (inGroup) {
        inGroup.result = { content: m.content, isError: m.isError };
      } else {
        const t = toolByUseId.get(m.toolUseId);
        if (t) {
          t.result = { content: m.content, isError: m.isError };
        } else {
          closeGroup();
          out.push({
            kind: "tool",
            id: m.id,
            toolUseId: m.toolUseId,
            name: "tool",
            input: {},
            result: { content: m.content, isError: m.isError },
            parentToolUseId: m.parentToolUseId ?? null,
          });
        }
      }
    } else if (m.kind === "system") {
      closeGroup();
      out.push({ kind: "system", id: m.id, text: m.text });
    } else if (m.kind === "error") {
      closeGroup();
      out.push({ kind: "error", id: m.id, text: m.text });
    } else if (m.kind === "result") {
      closeGroup();
      out.push({
        kind: "result",
        id: m.id,
        success: m.success,
        text: m.text,
        cost: m.totalCostUsd,
        ms: m.durationMs,
      });
    }
  }
  // Flush any trailing group.
  closeGroup();
  return out;
}

function renderEntries(entries: CollapsedEntry[]): React.ReactNode[] {
  const childrenByParent = new Map<string, CollapsedEntry[]>();
  for (const e of entries) {
    let parent: string | null = null;
    if (e.kind === "assistant") parent = e.parentToolUseId ?? null;
    else if (e.kind === "tool") parent = e.parentToolUseId ?? null;
    else if (e.kind === "explore_group") parent = e.parentToolUseId ?? null;
    if (parent) {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent)!.push(e);
    }
  }

  const nodes: React.ReactNode[] = [];
  for (const e of entries) {
    if (
      (e.kind === "assistant" && (e.parentToolUseId ?? null)) ||
      (e.kind === "tool" && (e.parentToolUseId ?? null)) ||
      (e.kind === "explore_group" && (e.parentToolUseId ?? null))
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
    case "thinking":
      return (
        <ThinkingBlock key={e.id} text={e.text} durationMs={e.durationMs} />
      );
    case "explore_group":
      return (
        <ExploreGroup key={e.id} tools={e.tools} />
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

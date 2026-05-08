import React, { useEffect, useRef } from "react";
import type { ContextUsage, EffortLevel, Mode, PermissionOverride } from "../../../src/util/messages";
import { EffortStrip } from "./EffortStrip";

type ModeOption = {
  id: Mode;
  label: string;
  hint: string;
  icon: string;
};

const MODE_OPTIONS: ModeOption[] = [
  { id: "plan", label: "Plan", icon: "▤", hint: "Explore + plan only — no edits" },
  { id: "debug", label: "Debug", icon: "✕", hint: "Hypothesis-driven debugging" },
  { id: "multitask", label: "Multitask", icon: "◎", hint: "Dispatch parallel subagents" },
  { id: "ask", label: "Ask", icon: "?", hint: "Read-only Q&A" },
  { id: "agent", label: "Agent", icon: "●", hint: "Default — full toolset" },
];

const PERM_OPTIONS: { id: PermissionOverride; label: string; icon: string; hint: string }[] = [
  { id: "readOnly", label: "Read-only", icon: "🔒", hint: "Strip Edit/Write/Bash for this run" },
  { id: "default", label: "Ask first", icon: "✏️", hint: "Route Edit/Write/Bash through approval dialog" },
  { id: "acceptEdits", label: "Auto-approve", icon: "⚡", hint: "Apply edits without prompts" },
];

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

type Props = {
  open: boolean;
  active: Mode;
  onPick: (m: Mode) => void;
  onClose: () => void;
  /** Per-run permission override — lives in Permissions section. */
  permLevel?: PermissionOverride;
  onPermChange?: (p: PermissionOverride) => void;
  /** Live context usage for the inline meter. */
  usage?: ContextUsage | null;
  /** Reasoning effort + thinking toggle (Cursor-style Model section). */
  effort: EffortLevel;
  onEffortChange: (e: EffortLevel) => void;
  thinkingEnabled: boolean;
  onThinkingChange: (enabled: boolean) => void;
  /** Bridge to the parent's panel/menu/slash routing. */
  onAttachFile: () => void;
  onMentionFile: () => void;
  onClear: () => void;
  onSwitchModel: () => void;
  onAccountUsage: () => void;
};

export function ModePicker({
  open,
  active,
  onPick,
  onClose,
  permLevel,
  onPermChange,
  usage,
  effort,
  onEffortChange,
  thinkingEnabled,
  onThinkingChange,
  onAttachFile,
  onMentionFile,
  onClear,
  onSwitchModel,
  onAccountUsage,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const used = usage ? usage.inputTokens + usage.outputTokens : 0;
  const limit = usage?.contextLimit || 200_000;
  const pct = usage ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct < 60 ? "ok" : pct < 85 ? "warn" : "err";

  return (
    <div className="modepicker" ref={ref} role="menu">
      <div className="modepicker-title">Add agents, context, tools…</div>

      {/* ── Context ── */}
      <div className="modepicker-section-label">Context</div>
      <div className="modepicker-section">
        <button
          className="modepicker-item"
          onClick={() => { onAttachFile(); onClose(); }}
          title="Attach a workspace file by name"
        >
          <span className="mp-icon" aria-hidden>▢</span>
          <span className="mp-label">Attach file…</span>
        </button>
        <button
          className="modepicker-item"
          onClick={() => { onMentionFile(); onClose(); }}
          title="Insert @ to mention a file from this project"
        >
          <span className="mp-icon" aria-hidden>@</span>
          <span className="mp-label">Mention file from this project…</span>
        </button>
        <button
          className="modepicker-item"
          onClick={() => { onClear(); onClose(); }}
          title="Start a fresh transcript (= /clear)"
        >
          <span className="mp-icon" aria-hidden>⌫</span>
          <span className="mp-label">Clear conversation</span>
        </button>
        <button
          className="modepicker-item disabled"
          disabled
          title="Rewind a previous turn — coming soon"
        >
          <span className="mp-icon" aria-hidden>↺</span>
          <span className="mp-label">Rewind</span>
        </button>
      </div>

      <div className="modepicker-divider" />

      {/* ── Modes ── */}
      <div className="modepicker-section-label">Modes</div>
      <div className="modepicker-section">
        {MODE_OPTIONS.map((m) => (
          <button
            key={m.id}
            className={`modepicker-item${active === m.id ? " active" : ""}`}
            role="menuitem"
            onClick={() => { onPick(m.id); onClose(); }}
            title={m.hint}
          >
            <span className="mp-icon" aria-hidden>{m.icon}</span>
            <span className="mp-label">{m.label}</span>
            {active === m.id && <span className="mp-check">✓</span>}
          </button>
        ))}
      </div>

      <div className="modepicker-divider" />

      {/* ── Permissions ── */}
      {onPermChange && permLevel !== undefined && (
        <>
          <div className="modepicker-section-label">Permissions (this run)</div>
          <div className="modepicker-section">
            {PERM_OPTIONS.map((p) => (
              <button
                key={p.id}
                className={`modepicker-item${permLevel === p.id ? " active" : ""}`}
                role="menuitem"
                onClick={() => { onPermChange(p.id); onClose(); }}
                title={p.hint}
              >
                <span className="mp-icon" aria-hidden>{p.icon}</span>
                <span className="mp-label">{p.label}</span>
                {permLevel === p.id && <span className="mp-check">✓</span>}
              </button>
            ))}
          </div>
          <div className="modepicker-divider" />
        </>
      )}

      {/* ── Context window meter ── */}
      {usage && (
        <>
          <div className="modepicker-section-label">Context window</div>
          <div className="modepicker-ctx">
            <div className="mp-ctx-track">
              <div className={`mp-ctx-fill mp-ctx-${tone}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mp-ctx-text">
              {formatTokens(used)} / {formatTokens(limit)}
              <span className="mp-ctx-pct"> ({pct}%)</span>
            </div>
            <div className="mp-ctx-sub">
              in {formatTokens(usage.inputTokens)} · out {formatTokens(usage.outputTokens)}
            </div>
          </div>
          <div className="modepicker-divider" />
        </>
      )}

      {/* ── Model ── */}
      <div className="modepicker-section-label">Model</div>
      <div className="modepicker-section">
        <button
          className="modepicker-item"
          onClick={() => { onSwitchModel(); onClose(); }}
          title="Choose between Sonnet 4.6 / Opus 4.7 / Haiku 4.5"
        >
          <span className="mp-icon" aria-hidden>✱</span>
          <span className="mp-label">Switch model…</span>
          <span className="mp-arrow">›</span>
        </button>

        <div className="modepicker-effort">
          <div className="mp-effort-head">
            <span className="mp-icon" aria-hidden>⚡</span>
            <span className="mp-label">Effort</span>
          </div>
          <EffortStrip level={effort} onChange={onEffortChange} />
        </div>

        <button
          className={`modepicker-item modepicker-toggle${thinkingEnabled ? " on" : ""}`}
          onClick={() => onThinkingChange(!thinkingEnabled)}
          title={
            thinkingEnabled
              ? "Extended thinking is ON (adaptive). Click to disable for fastest responses."
              : "Extended thinking is OFF. Click to enable adaptive thinking."
          }
        >
          <span className="mp-icon" aria-hidden>💭</span>
          <span className="mp-label">Thinking</span>
          <span className={`mp-toggle${thinkingEnabled ? " on" : ""}`} aria-hidden>
            <span className="mp-toggle-knob" />
          </span>
        </button>

        <button
          className="modepicker-item"
          onClick={() => { onAccountUsage(); onClose(); }}
          title="Last run cost & duration"
        >
          <span className="mp-icon" aria-hidden>＄</span>
          <span className="mp-label">Account &amp; usage</span>
        </button>
      </div>
    </div>
  );
}

export const MODE_LABEL: Record<Mode, string> = {
  agent: "Agent",
  plan: "Plan",
  ask: "Ask",
  multitask: "Multitask",
  debug: "Debug",
};

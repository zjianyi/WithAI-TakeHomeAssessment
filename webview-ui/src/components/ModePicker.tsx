import React, { useEffect, useRef } from "react";
import type { Mode, PermissionOverride, ContextUsage } from "../../../src/util/messages";

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

const PLACEHOLDER_GROUPS: { label: string; icon: string; arrow?: boolean; tooltip: string }[] = [
  { label: "Image", icon: "▢", tooltip: "Attach an image — coming soon" },
  { label: "Models", icon: "✧", arrow: true, tooltip: "Switch model — coming soon" },
  { label: "Skills", icon: "◆", arrow: true, tooltip: "Browse skills — coming soon" },
  { label: "MCP Servers", icon: "◈", arrow: true, tooltip: "Configure MCP — coming soon" },
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
  /** Context usage for the inline context meter. */
  usage?: ContextUsage | null;
};

export function ModePicker({ open, active, onPick, onClose, permLevel, onPermChange, usage }: Props) {
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

      {/* ── Context ── */}
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

      {/* ── More (placeholders) ── */}
      <div className="modepicker-section-label">More</div>
      <div className="modepicker-section">
        {PLACEHOLDER_GROUPS.map((g) => (
          <button
            key={g.label}
            className="modepicker-item disabled"
            disabled
            title={g.tooltip}
          >
            <span className="mp-icon" aria-hidden>{g.icon}</span>
            <span className="mp-label">{g.label}</span>
            {g.arrow && <span className="mp-arrow">›</span>}
          </button>
        ))}
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

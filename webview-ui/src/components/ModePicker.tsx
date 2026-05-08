import React, { useEffect, useRef } from "react";
import type { Mode } from "../../../src/util/messages";

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

const PLACEHOLDER_GROUPS: { label: string; icon: string; arrow?: boolean; tooltip: string }[] = [
  { label: "Image", icon: "▢", tooltip: "Attach an image — coming soon" },
  { label: "Models", icon: "✧", arrow: true, tooltip: "Switch model — coming soon" },
  { label: "Skills", icon: "◆", arrow: true, tooltip: "Browse skills — coming soon" },
  { label: "MCP Servers", icon: "◈", arrow: true, tooltip: "Configure MCP — coming soon" },
];

type Props = {
  open: boolean;
  active: Mode;
  onPick: (m: Mode) => void;
  onClose: () => void;
};

export function ModePicker({ open, active, onPick, onClose }: Props) {
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
  return (
    <div className="modepicker" ref={ref} role="menu">
      <div className="modepicker-title">Add agents, context, tools…</div>
      <div className="modepicker-section">
        {MODE_OPTIONS.map((m) => (
          <button
            key={m.id}
            className={`modepicker-item${active === m.id ? " active" : ""}`}
            role="menuitem"
            onClick={() => {
              onPick(m.id);
              onClose();
            }}
            title={m.hint}
          >
            <span className="mp-icon" aria-hidden>
              {m.icon}
            </span>
            <span className="mp-label">{m.label}</span>
            {active === m.id && <span className="mp-check">✓</span>}
          </button>
        ))}
      </div>
      <div className="modepicker-divider" />
      <div className="modepicker-section">
        {PLACEHOLDER_GROUPS.map((g) => (
          <button
            key={g.label}
            className="modepicker-item disabled"
            disabled
            title={g.tooltip}
          >
            <span className="mp-icon" aria-hidden>
              {g.icon}
            </span>
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

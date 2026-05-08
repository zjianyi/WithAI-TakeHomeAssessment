import React from "react";
import type { PermissionOverride } from "../../../src/util/messages";

type Props = {
  level: PermissionOverride;
  baseline: PermissionOverride;
  onChange: (next: PermissionOverride) => void;
};

const ORDER: PermissionOverride[] = ["readOnly", "default", "acceptEdits"];

const META: Record<PermissionOverride, { label: string; icon: string; tip: string }> = {
  readOnly: {
    label: "Read-only",
    icon: "🔒",
    tip: "Read-only — strip Edit/Write/Bash for this run only (mode unchanged)",
  },
  default: {
    label: "Ask first",
    icon: "✏️",
    tip: "Ask first — Edit/Write/Bash route through the approval dialog",
  },
  acceptEdits: {
    label: "Auto-approve",
    icon: "⚡",
    tip: "Auto-approve — Edits & writes apply without prompts (acceptEdits)",
  },
};

/**
 * Per-run permission pill in the composer. Cycles Read-only → Ask first →
 * Auto-approve on click. Orthogonal to Mode: it only changes whether/how the
 * agent's mutating tools are gated, never which tools the mode exposes (with
 * the exception of "readOnly", which intersects the mode tool list with
 * READ_ONLY_TOOLS for that run).
 */
export function PermPill({ level, baseline, onChange }: Props) {
  function cycle() {
    const i = ORDER.indexOf(level);
    onChange(ORDER[(i + 1) % ORDER.length]);
  }

  const m = META[level];
  const overridden = level !== baseline;
  return (
    <button
      className={`perm-pill perm-${level}${overridden ? " overridden" : ""}`}
      onClick={cycle}
      title={`${m.tip}${overridden ? "  (overrides workspace baseline)" : ""}`}
      aria-label={`Permission: ${m.label}. Click to cycle.`}
    >
      <span className="perm-icon" aria-hidden>{m.icon}</span>
      <span className="perm-label">{m.label}</span>
    </button>
  );
}

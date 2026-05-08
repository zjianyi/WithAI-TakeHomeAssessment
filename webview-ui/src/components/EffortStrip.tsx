import React from "react";
import type { EffortLevel } from "../../../src/util/messages";

type Props = {
  level: EffortLevel;
  onChange: (next: EffortLevel) => void;
};

const ORDER: EffortLevel[] = ["low", "medium", "high", "max"];
const LABEL: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};
const DESC: Record<EffortLevel, string> = {
  low: "Minimal thinking, fastest responses",
  medium: "Moderate thinking",
  high: "Deep reasoning (default)",
  max: "Maximum effort (Opus 4.7 only — silently downgrades elsewhere)",
};

/**
 * 4-position dot strip that mirrors Cursor's Effort selector. Click any dot
 * to set; the active dot is filled, the others hollow. Underneath, a one-line
 * description of the active level for context.
 */
export function EffortStrip({ level, onChange }: Props) {
  return (
    <div className="effort-strip" role="radiogroup" aria-label="Reasoning effort">
      <div className="effort-dots">
        {ORDER.map((l) => (
          <button
            key={l}
            className={`effort-dot${l === level ? " active" : ""}`}
            role="radio"
            aria-checked={l === level}
            aria-label={`Effort: ${LABEL[l]}`}
            title={`${LABEL[l]} — ${DESC[l]}`}
            onClick={() => onChange(l)}
          >
            <span className="effort-dot-inner" />
          </button>
        ))}
      </div>
      <div className="effort-meta">
        <span className="effort-label">{LABEL[level]}</span>
        <span className="effort-desc">{DESC[level]}</span>
      </div>
    </div>
  );
}

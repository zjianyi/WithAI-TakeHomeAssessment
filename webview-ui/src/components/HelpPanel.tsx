import React, { useEffect } from "react";
import type { SlashCommandMeta } from "../../../src/util/messages";

type Props = {
  open: boolean;
  commands: SlashCommandMeta[];
  onClose: () => void;
  onPick: (name: string) => void;
};

const KIND_LABEL: Record<SlashCommandMeta["kind"], string> = {
  local: "client",
  "local-jsx": "panel",
  prompt: "agent",
};

const KIND_HINT: Record<SlashCommandMeta["kind"], string> = {
  local: "Runs in the extension — no API call",
  "local-jsx": "Opens a UI panel (no API call)",
  prompt: "Sends a templated prompt to the agent (uses tokens)",
};

const SECTION_ORDER: SlashCommandMeta["kind"][] = ["local-jsx", "local", "prompt"];
const SECTION_TITLE: Record<SlashCommandMeta["kind"], string> = {
  "local-jsx": "Panels",
  local: "Client actions",
  prompt: "Agent prompts",
};

export function HelpPanel({ open, commands, onClose, onPick }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const grouped: Record<SlashCommandMeta["kind"], SlashCommandMeta[]> = {
    local: [],
    "local-jsx": [],
    prompt: [],
  };
  for (const c of commands) grouped[c.kind].push(c);

  return (
    <div className="help-panel-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="help-panel-head">
          <span className="help-panel-title">Slash commands</span>
          <button className="help-panel-close" onClick={onClose} aria-label="Close help">
            ×
          </button>
        </div>
        <div className="help-panel-hint">
          Type <code>/</code> in the composer to open the picker, or click a row below to insert.
        </div>
        <div className="help-panel-body">
          {SECTION_ORDER.map((kind) => {
            const list = grouped[kind];
            if (list.length === 0) return null;
            return (
              <div key={kind} className="help-section">
                <div className="help-section-title">{SECTION_TITLE[kind]}</div>
                {list.map((c) => (
                  <button
                    key={c.name}
                    className="help-row"
                    onClick={() => {
                      onPick(c.name);
                      onClose();
                    }}
                    title={KIND_HINT[c.kind]}
                  >
                    <span className="help-row-name">/{c.name}</span>
                    <span className="help-row-desc">{c.desc}</span>
                    <span className={`help-row-chip chip-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="help-panel-foot">
          <span>
            <code>@</code> mentions a workspace file
          </span>
          <span>
            <code>Esc</code> closes
          </span>
          <span>
            <code>Enter</code> sends · <code>Shift+Enter</code> newline
          </span>
        </div>
      </div>
    </div>
  );
}

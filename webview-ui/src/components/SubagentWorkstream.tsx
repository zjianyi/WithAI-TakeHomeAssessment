import React, { useState } from "react";
import type { CollapsedEntry } from "../App";

type Props = {
  /** The Agent tool_use that spawned this subagent. */
  parentTool: Extract<CollapsedEntry, { kind: "tool" }>;
  /** All entries (assistant text + nested tool uses) attributed to this subagent. */
  entries: CollapsedEntry[];
  renderEntry: (e: CollapsedEntry) => React.ReactNode;
};

function summarizeAgentInput(input: Record<string, unknown>): {
  subagent: string;
  description: string;
} {
  const subagent =
    (input.subagent_type as string | undefined) ??
    (input.subagentType as string | undefined) ??
    "worker";
  const description =
    (input.description as string | undefined) ??
    (input.prompt as string | undefined)?.slice(0, 80) ??
    "";
  return { subagent, description };
}

export function SubagentWorkstream({ parentTool, entries, renderEntry }: Props) {
  const { subagent, description } = summarizeAgentInput(parentTool.input);
  const done = parentTool.result !== undefined;
  const [open, setOpen] = useState(true);

  return (
    <div className="workstream">
      <div className="workstream-header" onClick={() => setOpen((v) => !v)}>
        <span className="ws-chev">{open ? "▾" : "▸"}</span>
        <span className="ws-name">subagent · {subagent}</span>
        {description && (
          <span style={{ color: "var(--muted)", fontSize: 11 }}>· {description}</span>
        )}
        <span className={`ws-status ${done ? "done" : "running"}`}>
          {done ? "done" : "running…"}
        </span>
      </div>
      {open && (
        <div className="workstream-body">
          {entries.length === 0 && (
            <div className="msg system">
              <span className="glyph">∴</span>
              Worker dispatched · awaiting first message…
            </div>
          )}
          {entries.map((c) => renderEntry(c))}
          {done && parentTool.result?.content !== undefined && (
            <div className="msg system" style={{ marginTop: 6 }}>
              <span className="glyph">↩</span>
              worker reported back
            </div>
          )}
        </div>
      )}
    </div>
  );
}

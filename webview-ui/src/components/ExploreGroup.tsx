import React, { useState } from "react";
import { toolLineSummary, exploreHeader } from "../util/toolSummary";

type ToolEntry = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: { content: unknown; isError?: boolean };
};

type Props = {
  tools: ToolEntry[];
};

/**
 * Collapses a cluster of read-only tool calls into a single
 * "Explored N files, M searches ▾" header, matching Cursor's UX.
 * Expanded view shows one compact line per tool call.
 */
export function ExploreGroup({ tools }: Props) {
  const [open, setOpen] = useState(false);
  const header = exploreHeader(tools.map((t) => t.name));
  const allDone = tools.every((t) => t.result !== undefined);

  return (
    <div className="explore-group">
      <button
        className="explore-group-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="explore-icon" aria-hidden>
          {allDone ? "▾" : "⋯"}
        </span>
        <span className="explore-label">{header}</span>
        <span className="explore-chev" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="explore-group-body">
          {tools.map((t) => (
            <div key={t.id} className="explore-row">
              <span className="explore-tool-name">{t.name}</span>
              <span className="explore-tool-summary">
                {toolLineSummary(t.name, t.input)}
              </span>
              {t.result?.isError && (
                <span className="explore-tool-err" title="error">✗</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

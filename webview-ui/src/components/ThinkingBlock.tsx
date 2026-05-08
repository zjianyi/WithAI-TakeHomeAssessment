import React, { useState } from "react";

type Props = {
  text: string;
  durationMs?: number;
};

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(0)}s`;
}

/**
 * Renders an SDK extended-thinking block as a collapsible "Thought for Xs ▾"
 * row, matching Cursor's visual treatment. Collapsed by default — the thinking
 * text is secondary to the final answer.
 */
export function ThinkingBlock({ text, durationMs }: Props) {
  const [open, setOpen] = useState(false);
  const dur = formatDuration(durationMs);

  return (
    <div className="thinking-block">
      <button
        className="thinking-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="thinking-icon" aria-hidden>💭</span>
        <span className="thinking-label">
          Thought{dur ? ` for ${dur}` : ""}
        </span>
        <span className="thinking-chev" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="thinking-body">
          <pre className="thinking-text">{text}</pre>
        </div>
      )}
    </div>
  );
}

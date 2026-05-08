import React, { useState } from "react";
import type { ContextUsage } from "../../../src/util/messages";

type Props = {
  usage: ContextUsage | null;
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function ContextBar({ usage }: Props) {
  const [showTip, setShowTip] = useState(false);

  if (!usage) return null;
  const used = usage.inputTokens + usage.outputTokens;
  const limit = usage.contextLimit || 200_000;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone = pct < 60 ? "ok" : pct < 85 ? "warn" : "err";

  return (
    <div
      className={`ctxbar ctxbar-${tone}`}
      onClick={() => setShowTip((v) => !v)}
      title="Click for breakdown"
    >
      <span className="ctx-label">context</span>
      <div className="ctx-track">
        <div className="ctx-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ctx-text">
        {formatTokens(used)} / {formatTokens(limit)} <span className="ctx-pct">({pct}%)</span>
      </span>
      {showTip && (
        <div className="ctx-tip" onClick={(e) => e.stopPropagation()}>
          <div>
            input: <b>{formatTokens(usage.inputTokens)}</b>
          </div>
          <div>
            output: <b>{formatTokens(usage.outputTokens)}</b>
          </div>
          <div>
            cache read: <b>{formatTokens(usage.cacheReadTokens)}</b>
          </div>
          <div>
            cache create: <b>{formatTokens(usage.cacheCreateTokens)}</b>
          </div>
          <div className="ctx-tip-divider" />
          <div>
            last turn: in <b>{formatTokens(usage.lastTurnInput)}</b> · out{" "}
            <b>{formatTokens(usage.lastTurnOutput)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

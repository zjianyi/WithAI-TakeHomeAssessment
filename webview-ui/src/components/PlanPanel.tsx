import React, { useEffect, useRef } from "react";
import { Markdown } from "./Markdown";
import { BuildDialog } from "./BuildDialog";

type Props = {
  state: "live" | "review";
  content: string;
  onBack: () => void;
  onOpenInEditor: () => void;
  onBuild: (followUp?: string) => void;
  onBuildSafe: (followUp?: string) => void;
  onRefine: (followUp?: string) => void;
};

/**
 * Full-width sidebar takeover that surfaces the active plan-mode output.
 * Streams while the agent is producing text and switches to a review state
 * (with the BuildDialog) once the turn lands a `result`.
 *
 * Why full-width: the sidebar is typically 350–450 px. A 50/50 split with the
 * transcript would leave both columns ~200 px which is unreadable for
 * code-heavy plans, so we take over the panel and provide a `← Back to chat`
 * button to flip back without losing transcript state.
 */
export function PlanPanel({
  state,
  content,
  onBack,
  onOpenInEditor,
  onBuild,
  onBuildSafe,
  onRefine,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      pinnedRef.current = distance < 32;
    }
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [content]);

  return (
    <div className="plan-panel">
      <div className="plan-panel-header">
        <button className="plan-back" onClick={onBack} title="Back to chat">
          ← Back to chat
        </button>
        <span className="plan-title">Plan</span>
        <span className={`plan-state plan-state-${state}`}>
          {state === "live" ? "Streaming…" : "Ready for review"}
        </span>
        <button
          className="plan-iconbtn"
          title="Open in editor"
          aria-label="Open plan in editor"
          onClick={onOpenInEditor}
        >
          ↗
        </button>
      </div>

      <div className="plan-panel-body" ref={bodyRef}>
        {content ? (
          <Markdown text={content} />
        ) : (
          <div className="plan-empty">
            Plan-mode output will stream here as Claude writes it.
          </div>
        )}
      </div>

      {state === "review" && (
        <div className="plan-panel-footer">
          <BuildDialog
            onBuild={(f) => onBuild(f)}
            onBuildSafe={(f) => onBuildSafe(f)}
            onRefine={(f) => onRefine(f)}
            onCancel={onBack}
          />
        </div>
      )}
    </div>
  );
}

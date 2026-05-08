import React, { useEffect, useRef, useState } from "react";

type Props = {
  onBuild: (followUp?: string) => void;
  onBuildSafe: (followUp?: string) => void;
  onRefine: (followUp?: string) => void;
  onCancel?: () => void;
};

/**
 * Mirrors the Cursor "Accept this plan?" dialog. Three numbered options with
 * the orange-highlighted default at the top, a follow-up textarea, and an
 * `Esc to cancel` hint. Number keys 1/2/3 also trigger the corresponding
 * action so power users can drive it from the keyboard.
 */
export function BuildDialog({ onBuild, onBuildSafe, onRefine, onCancel }: Props) {
  const [followUp, setFollowUp] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "1") { e.preventDefault(); onBuild(followUp.trim() || undefined); }
      else if (e.key === "2") { e.preventDefault(); onBuildSafe(followUp.trim() || undefined); }
      else if (e.key === "3") { e.preventDefault(); onRefine(followUp.trim() || undefined); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel?.(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [followUp, onBuild, onBuildSafe, onRefine, onCancel]);

  function handleEnter(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onRefine(followUp.trim() || undefined);
    }
  }

  return (
    <div className="build-dialog" role="dialog" aria-label="Accept this plan?">
      <div className="build-dialog-title">Accept this plan?</div>
      <div className="build-dialog-sub">Select text in the plan to add comments</div>

      <div className="build-options">
        <button
          className="build-opt primary"
          onClick={() => onBuild(followUp.trim() || undefined)}
          title="Build the plan with auto-approved edits"
        >
          <span className="opt-num">1</span>
          <span className="opt-label">Build (auto-approve edits)</span>
        </button>
        <button
          className="build-opt"
          onClick={() => onBuildSafe(followUp.trim() || undefined)}
          title="Build the plan; review each edit"
        >
          <span className="opt-num">2</span>
          <span className="opt-label">Build with approval (review each edit)</span>
        </button>
        <button
          className="build-opt"
          onClick={() => onRefine(followUp.trim() || undefined)}
          title="Send the follow-up back to plan mode"
        >
          <span className="opt-num">3</span>
          <span className="opt-label">No, keep refining</span>
        </button>
      </div>

      <textarea
        ref={taRef}
        className="build-followup"
        rows={2}
        placeholder="Tell Claude what to refine…"
        value={followUp}
        onChange={(e) => setFollowUp(e.target.value)}
        onKeyDown={handleEnter}
      />
      <div className="build-hint">
        <span>1·Build · 2·Build w/approval · 3·Refine</span>
        <span className="esc">Esc to cancel</span>
      </div>
    </div>
  );
}

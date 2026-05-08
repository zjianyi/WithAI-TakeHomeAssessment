import React, { useEffect, useState } from "react";
import type { PermissionBaseline } from "../../../src/util/messages";

type Group = {
  id: string;
  label: string;
  tools: string[];
  /** Tools that warrant approval gating when allowed. */
  gateable: boolean;
};

const GROUPS: Group[] = [
  { id: "read",   label: "Read / Search",  tools: ["Read", "Glob", "Grep"],         gateable: false },
  { id: "edit",   label: "File edits",     tools: ["Edit", "Write"],                gateable: true },
  { id: "bash",   label: "Bash / commands", tools: ["Bash"],                         gateable: true },
  { id: "web",    label: "Web (search/fetch)", tools: ["WebSearch", "WebFetch"],    gateable: false },
  { id: "todo",   label: "TodoWrite",      tools: ["TodoWrite"],                    gateable: false },
];

type Props = {
  open: boolean;
  baseline: PermissionBaseline;
  onClose: () => void;
  onSave: (next: PermissionBaseline) => void;
};

/**
 * Persistent permission panel. Opens as a slide-down drawer above the
 * composer (not a modal). Each tool group has an "allowed" checkbox; the two
 * gateable groups also surface "auto-approve" — when ALL gateable groups are
 * auto-approve, the saved baseline is `acceptEdits`, otherwise `default`
 * (the SDK gates everything mutating through canUseTool).
 */
export function PermissionsPanel({ open, baseline, onClose, onSave }: Props) {
  const [allowed, setAllowed] = useState<Set<string>>(new Set(baseline.allowedTools));
  const [autoApprove, setAutoApprove] = useState<boolean>(baseline.permissionMode === "acceptEdits");

  useEffect(() => {
    if (open) {
      setAllowed(new Set(baseline.allowedTools));
      setAutoApprove(baseline.permissionMode === "acceptEdits");
    }
  }, [open, baseline]);

  if (!open) return null;

  function toggleGroup(g: Group, on: boolean) {
    setAllowed((prev) => {
      const next = new Set(prev);
      for (const t of g.tools) {
        if (on) next.add(t);
        else next.delete(t);
      }
      return next;
    });
  }
  function isGroupOn(g: Group): boolean {
    return g.tools.every((t) => allowed.has(t));
  }

  function save() {
    onSave({
      permissionMode: autoApprove ? "acceptEdits" : "default",
      allowedTools: [...allowed],
    });
    onClose();
  }

  return (
    <div className="perm-panel" role="region" aria-label="Permissions">
      <div className="perm-panel-head">
        <span className="perm-panel-title">Permissions</span>
        <button className="perm-panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="perm-panel-cols">
        <div className="perm-col-h">Tool group</div>
        <div className="perm-col-h center">Allowed</div>
        <div className="perm-col-h center">Notes</div>
      </div>
      {GROUPS.map((g) => {
        const on = isGroupOn(g);
        return (
          <div className="perm-row" key={g.id}>
            <div className="perm-row-label">{g.label}</div>
            <div className="perm-row-cell center">
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => toggleGroup(g, e.target.checked)}
                aria-label={`Allow ${g.label}`}
              />
            </div>
            <div className="perm-row-cell perm-row-note">
              {g.gateable
                ? on
                  ? autoApprove
                    ? "auto-approved"
                    : "gated by approval"
                  : "blocked"
                : on
                  ? "always pre-approved"
                  : "blocked"}
            </div>
          </div>
        );
      })}
      <div className="perm-panel-baseline">
        <label className="perm-baseline-label">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)}
          />
          <span>Auto-approve edits (acceptEdits) by default</span>
        </label>
        <button className="perm-save" onClick={save}>Save to workspace</button>
      </div>
    </div>
  );
}

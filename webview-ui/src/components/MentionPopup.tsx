import React from "react";
import type { WorkspaceFile } from "../../../src/util/messages";

type SlashCmd = { name: string; desc: string };

type Props =
  | { mode: "files"; files: WorkspaceFile[]; active: number; onPick: (f: WorkspaceFile) => void }
  | { mode: "slash"; commands: SlashCmd[]; active: number; onPick: (c: SlashCmd) => void };

export function MentionPopup(p: Props) {
  if (p.mode === "files") {
    if (p.files.length === 0) {
      return (
        <div className="popup">
          <div className="item" style={{ color: "var(--subtle)" }}>No matches</div>
        </div>
      );
    }
    return (
      <div className="popup">
        {p.files.map((f, i) => {
          const slash = f.rel.lastIndexOf("/");
          const dir = slash >= 0 ? f.rel.slice(0, slash + 1) : "";
          const base = slash >= 0 ? f.rel.slice(slash + 1) : f.rel;
          return (
            <div
              key={f.path}
              className={`item${i === p.active ? " active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                p.onPick(f);
              }}
            >
              <span>
                <span className="dir">{dir}</span>
                <span className="basename">{base}</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="popup">
      {p.commands.map((c, i) => (
        <div
          key={c.name}
          className={`item${i === p.active ? " active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            p.onPick(c);
          }}
        >
          <span className="basename">/{c.name}</span>
          <span className="desc">{c.desc}</span>
        </div>
      ))}
    </div>
  );
}

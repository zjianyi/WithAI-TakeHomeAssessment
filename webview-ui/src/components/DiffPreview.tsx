import React from "react";

export function DiffPreview({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <div className="diff">
      {lines.map((ln, i) => {
        let cls = "row";
        if (ln.startsWith("+++") || ln.startsWith("---") || ln.startsWith("Index:")) cls += " meta";
        else if (ln.startsWith("@@")) cls += " hunk";
        else if (ln.startsWith("+")) cls += " add";
        else if (ln.startsWith("-")) cls += " del";
        if (ln === "" && i === lines.length - 1) return null;
        return (
          <span key={i} className={cls}>
            {ln || " "}
          </span>
        );
      })}
    </div>
  );
}

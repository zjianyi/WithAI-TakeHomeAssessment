import React, { useState } from "react";
import { send } from "../lib/vscodeApi";

type Props = {
  name: string;
  input: Record<string, unknown>;
  result?: { content: unknown; isError?: boolean };
};

function summarize(name: string, input: Record<string, unknown>): string {
  const fp = (input.file_path as string) || (input.path as string) || (input.notebook_path as string);
  if (fp) return fp;
  if (name === "Bash") return String(input.command ?? "").slice(0, 80);
  if (name === "Glob") return String(input.pattern ?? "");
  if (name === "Grep") {
    const p = input.pattern as string | undefined;
    const path = input.path as string | undefined;
    return p ? `${p}${path ? "  in " + path : ""}` : "";
  }
  if (name === "WebSearch" || name === "WebFetch") return String(input.query ?? input.url ?? "");
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  const first = keys[0];
  const v = input[first];
  return typeof v === "string" ? `${first}: ${v.slice(0, 60)}` : `${first}: …`;
}

function renderResult(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (c && typeof c === "object" && "text" in (c as Record<string, unknown>)) {
          return String((c as { text: unknown }).text);
        }
        return JSON.stringify(c);
      })
      .join("\n");
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export function ToolUseBlock({ name, input, result }: Props) {
  const [open, setOpen] = useState(false);
  const summary = summarize(name, input);
  const onClick = () => {
    const fp = (input.file_path as string) || (input.path as string);
    if (fp && (name === "Read" || name === "Edit" || name === "Write")) {
      send({ type: "openFile", path: fp });
    }
    setOpen(!open);
  };
  return (
    <div className="tool">
      <div className="header" onClick={onClick}>
        <span className="glyph">●</span>
        <span className="name">{name}</span>
        <span className="args">({summary})</span>
        {!result && <span className="pending">⋯</span>}
        <span className="chev">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <>
          <div className="body">
            <div style={{ color: "var(--subtle)", marginBottom: 4 }}>input</div>
            {JSON.stringify(input, null, 2)}
          </div>
          {result && (
            <div className={`body${result.isError ? " error" : ""}`} style={{ marginTop: 4 }}>
              <div style={{ color: "var(--subtle)", marginBottom: 4 }}>
                {result.isError ? "error" : "result"}
              </div>
              {renderResult(result.content)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

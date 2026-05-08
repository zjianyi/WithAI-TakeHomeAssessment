import React, { useState } from "react";
import { send } from "../lib/vscodeApi";
import { BashBlock } from "./BashBlock";
import { DiffPreview } from "./DiffPreview";
import { toolLineSummary } from "../util/toolSummary";

type Props = {
  name: string;
  input: Record<string, unknown>;
  result?: { content: unknown; isError?: boolean };
};

// Lines threshold above which we truncate result content.
const PREVIEW_LINES = 9;
// Tail lines shown after the "… N more …" marker.
const TAIL_LINES = 3;

function flattenContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (c && typeof c === "object" && "text" in (c as Record<string, unknown>)) {
          return String((c as { text: unknown }).text);
        }
        return typeof c === "string" ? c : JSON.stringify(c);
      })
      .join("\n");
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

/** Truncated result body with expand toggle. */
function ResultBody({ content, isError }: { content: unknown; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const text = flattenContent(content);
  const lines = text.split("\n");
  const big = lines.length > PREVIEW_LINES || text.length > 1536;

  const display = !big || expanded
    ? text
    : [
        ...lines.slice(0, PREVIEW_LINES),
        `··· ${lines.length - PREVIEW_LINES - TAIL_LINES} more lines ···`,
        ...lines.slice(lines.length - TAIL_LINES),
      ].join("\n");

  return (
    <div className={`body${isError ? " error" : ""}`} style={{ marginTop: 4 }}>
      <div style={{ color: "var(--subtle)", marginBottom: 4 }}>
        {isError ? "error" : "result"}
      </div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{display}</pre>
      {big && (
        <button
          className="preview-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Collapse ▴" : `Show full ▾  (${lines.length} lines)`}
        </button>
      )}
    </div>
  );
}

/** Compact diff-stat header for Edit/Write tool blocks. */
function EditWriteBlock({ name, input, result }: Props) {
  const [showDiff, setShowDiff] = useState(false);
  const fp =
    (input.file_path as string | undefined) ??
    (input.path as string | undefined) ??
    "";
  const base = fp.split("/").pop() ?? fp;

  const onClick = () => {
    if (fp) send({ type: "openFile", path: fp });
    setShowDiff((v) => !v);
  };

  // For Edit: compute a rough +/- line count from old_string vs new_string.
  let statLabel = "";
  if (name === "Edit" || name === "MultiEdit") {
    const oldStr = String(input.old_string ?? "");
    const newStr = String(input.new_string ?? "");
    const added = newStr.split("\n").length;
    const removed = oldStr.split("\n").length;
    statLabel = `+${added} −${removed} in ${base}`;
  } else if (name === "Write") {
    const content = String(input.content ?? "");
    const lines = content.split("\n").length;
    statLabel = `${lines} lines → ${base}`;
  }

  return (
    <div className="tool">
      <div className="header" onClick={onClick} style={{ cursor: "pointer" }}>
        <span className="glyph">●</span>
        <span className="name">{name}</span>
        <span className="args">{statLabel}</span>
        {!result && <span className="pending">⋯</span>}
        <button
          className="diff-toggle-btn"
          onClick={(e) => { e.stopPropagation(); setShowDiff((v) => !v); }}
          title={showDiff ? "Collapse diff" : "Show diff"}
        >
          {showDiff ? "▴ diff" : "▾ diff"}
        </button>
      </div>
      {showDiff && (
        <div className="body" style={{ padding: 0 }}>
          {/* Show input (new_string / content) as diff preview if we have it */}
          {input.old_string !== undefined ? (
            <DiffPreview
              patch={buildEditPatch(
                String(input.file_path ?? input.path ?? "file"),
                String(input.old_string ?? ""),
                String(input.new_string ?? ""),
              )}
            />
          ) : input.content !== undefined ? (
            <pre style={{
              margin: 0, padding: "6px 8px", fontSize: "11.5px",
              fontFamily: "var(--mono)", whiteSpace: "pre-wrap",
              color: "var(--muted)", maxHeight: 320, overflow: "auto",
            }}>
              {String(input.content)}
            </pre>
          ) : null}
        </div>
      )}
      {result && (
        <ResultBody content={result.content} isError={result.isError} />
      )}
    </div>
  );
}

/**
 * Build a minimal unified-diff patch string for an Edit operation so we can
 * reuse DiffPreview without importing the full `diff` package in the webview.
 */
function buildEditPatch(file: string, oldStr: string, newStr: string): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const header = `--- ${file}\n+++ ${file}\n@@ -1,${oldLines.length} +1,${newLines.length} @@`;
  const del = oldLines.map((l) => `-${l}`).join("\n");
  const add = newLines.map((l) => `+${l}`).join("\n");
  return `${header}\n${del}\n${add}`;
}

export function ToolUseBlock({ name, input, result }: Props) {
  // Route Bash to dedicated terminal-style block.
  if (name === "Bash") {
    return <BashBlock input={input} result={result} />;
  }

  // Edit / Write / MultiEdit get a compact diff-stat instead of raw input dump.
  if (name === "Edit" || name === "Write" || name === "MultiEdit") {
    return <EditWriteBlock name={name} input={input} result={result} />;
  }

  // Generic tool block (Read, Glob, Grep, Agent, etc.)
  const [open, setOpen] = useState(false);
  const summary = toolLineSummary(name, input);

  const onClick = () => {
    const fp = (input.file_path as string) || (input.path as string);
    if (fp && (name === "Read" || name === "Edit" || name === "Write")) {
      send({ type: "openFile", path: fp });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="tool">
      <div className="header" onClick={onClick}>
        <span className="glyph">●</span>
        <span className="name">{name}</span>
        <span className="args">{summary}</span>
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
            <ResultBody content={result.content} isError={result.isError} />
          )}
        </>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { send } from "../lib/vscodeApi";

type Props = {
  input: Record<string, unknown>;
  result?: { content: unknown; isError?: boolean };
};

/**
 * Strip ANSI CSI / OSC escapes. The Bash tool returns colored output for many
 * commands (`npm test`, `tsc`, etc.) — without this we'd render `[36m` etc.
 */
function stripAnsi(s: string): string {
  // CSI sequences: ESC [ … letter
  // OSC sequences: ESC ] … BEL or ESC ] … ESC \
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[=>]/g, "");
}

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
  return typeof content === "object" ? JSON.stringify(content) : String(content);
}

const COLLAPSE_AFTER = 12;

export function BashBlock({ input, result }: Props) {
  const command = String(input.command ?? "");
  const description = (input.description as string | undefined) ?? "";
  const raw = result ? flattenContent(result.content) : "";
  const cleaned = stripAnsi(raw).replace(/\r\n/g, "\n");
  const lines = cleaned.length > 0 ? cleaned.split("\n") : [];
  const tooLong = lines.length > COLLAPSE_AFTER;
  const [expanded, setExpanded] = useState(false);

  const visible = !tooLong || expanded ? lines : [...lines.slice(0, COLLAPSE_AFTER)];
  const exitCode = inferExitCode(cleaned, result?.isError);

  return (
    <div className={`bashblock${result?.isError ? " error" : ""}`}>
      <div className="bashblock-head">
        <span className="bashblock-icon" aria-hidden>
          ▣
        </span>
        <span className="bashblock-label">Bash</span>
        {description && <span className="bashblock-desc">{description}</span>}
        <button
          className="bashblock-mirror"
          onClick={() => send({ type: "mirrorToTerminal", command })}
          title="Open this command in a real VS Code terminal"
        >
          ↗ terminal
        </button>
      </div>
      <pre className="bashblock-cmd">
        <span className="bashblock-prompt">$</span> {command}
      </pre>
      {result ? (
        lines.length === 0 ? (
          <div className="bashblock-empty">(no output)</div>
        ) : (
          <pre className="bashblock-out">
            {visible.join("\n")}
            {tooLong && !expanded ? `\n… ${lines.length - COLLAPSE_AFTER} more lines …` : ""}
          </pre>
        )
      ) : (
        <div className="bashblock-running">
          <span className="bashblock-spin" aria-hidden>
            ⋯
          </span>{" "}
          running…
        </div>
      )}
      {result && (
        <div className="bashblock-foot">
          <span className={`bashblock-exit ${exitCode === 0 ? "ok" : "err"}`}>
            {exitCode === 0 ? "⏎ exit 0" : `✗ exit ${exitCode ?? 1}`}
          </span>
          <span className="bashblock-meta">
            {lines.length} line{lines.length === 1 ? "" : "s"}
          </span>
          {tooLong && (
            <button
              className="bashblock-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Collapse ▴" : "Show full ▾"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The SDK Bash tool doesn't surface a numeric exit code in its tool_result
 * payload; it sets `is_error` true on failure. Cursor's UI shows a numeric
 * chip though, so we make a best effort: try to parse it from common patterns
 * in the output, otherwise fall back to 0/1 based on isError.
 */
function inferExitCode(out: string, isError?: boolean): number | null {
  // Patterns we sometimes see emitted by the SDK CLI bridge.
  const m = /(?:^|\n)Exit code:\s*(\d+)/i.exec(out) ?? /\bexit\s+(\d+)\b/.exec(out);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return n;
  }
  if (isError) return 1;
  return 0;
}

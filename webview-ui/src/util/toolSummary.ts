/**
 * One-liner formatters for tool calls. Matches the visual language of Cursor's
 * "Explored …" panel where each row reads like a sentence:
 *   `Read ToolUseBlock.tsx L1-86`
 *   `Grepped pattern in src`
 *   `Searched files src/**` + ` in claude-coder`
 *
 * Used by ExploreGroup (collapsed read-only cluster) and as the compact
 * fallback inside ToolUseBlock when we aren't rendering the full card.
 */

/** Tools whose results are inert (no filesystem mutation, no shell). */
export const READ_ONLY_TOOL_NAMES = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "NotebookRead",
  "TodoRead",
  "TodoWrite", // mutates only the agent's own todo list — safe to group
]);

export function basename(p: string): string {
  if (!p) return "";
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function shortenPattern(s: string, max = 60): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Categorize a tool for grouping headers ("Explored 2 files, 3 searches").
 * `null` means "do not group" (Edit/Write/Bash/Agent/etc.).
 */
export function toolCategory(name: string): "file" | "search" | "fetch" | null {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return "file";
    case "Glob":
      return "file";
    case "Grep":
    case "WebSearch":
      return "search";
    case "WebFetch":
      return "fetch";
    default:
      return null;
  }
}

/** Build the "Explored …" header label from a list of tool names. */
export function exploreHeader(toolNames: string[]): string {
  let files = 0;
  let searches = 0;
  let fetches = 0;
  for (const n of toolNames) {
    const c = toolCategory(n);
    if (c === "file") files += 1;
    else if (c === "search") searches += 1;
    else if (c === "fetch") fetches += 1;
  }
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (searches) parts.push(`${searches} search${searches === 1 ? "" : "es"}`);
  if (fetches) parts.push(`${fetches} fetch${fetches === 1 ? "" : "es"}`);
  if (parts.length === 0) return `Explored ${toolNames.length} item${toolNames.length === 1 ? "" : "s"}`;
  return `Explored ${parts.join(", ")}`;
}

/** Compact, sentence-style summary line for a single tool call. */
export function toolLineSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read": {
      const fp = (input.file_path as string) || (input.path as string) || "";
      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;
      const range =
        typeof offset === "number" && typeof limit === "number"
          ? ` L${offset}-${offset + limit}`
          : typeof limit === "number"
            ? ` L1-${limit}`
            : "";
      return `Read ${basename(fp) || fp}${range}`;
    }
    case "NotebookRead": {
      const fp = (input.notebook_path as string) || (input.path as string) || "";
      return `Read notebook ${basename(fp) || fp}`;
    }
    case "Glob": {
      const pattern = String(input.pattern ?? "");
      const path = (input.path as string | undefined) ?? "";
      return `Searched files ${shortenPattern(pattern)}${path ? ` in ${basename(path) || path}` : ""}`;
    }
    case "Grep": {
      const pattern = String(input.pattern ?? "");
      const path = (input.path as string | undefined) ?? "";
      return `Grepped ${shortenPattern(pattern)}${path ? ` in ${basename(path) || path}` : ""}`;
    }
    case "WebSearch": {
      const q = String(input.query ?? "");
      return `Searched web for "${shortenPattern(q, 50)}"`;
    }
    case "WebFetch": {
      const url = String(input.url ?? "");
      try {
        const u = new URL(url);
        return `Fetched ${u.hostname}`;
      } catch {
        return `Fetched ${shortenPattern(url, 60)}`;
      }
    }
    case "Bash": {
      return `Ran ${shortenPattern(String(input.command ?? ""), 70)}`;
    }
    case "Edit": {
      const fp = (input.file_path as string) || "";
      return `Edited ${basename(fp) || fp}`;
    }
    case "Write": {
      const fp = (input.file_path as string) || "";
      return `Wrote ${basename(fp) || fp}`;
    }
    case "MultiEdit": {
      const fp = (input.file_path as string) || "";
      const edits = Array.isArray(input.edits) ? input.edits.length : 0;
      return `Edited ${basename(fp) || fp} (${edits} change${edits === 1 ? "" : "s"})`;
    }
    case "Agent": {
      const desc = String(input.description ?? input.prompt ?? "subagent");
      return `Spawned subagent — ${shortenPattern(desc, 60)}`;
    }
    case "TodoWrite": {
      const todos = Array.isArray(input.todos) ? input.todos.length : 0;
      return `Updated todos (${todos})`;
    }
    default: {
      // Generic fallback: pick the first interesting key.
      const keys = Object.keys(input);
      if (keys.length === 0) return name;
      const first = keys[0];
      const v = input[first];
      const tail = typeof v === "string" ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60);
      return `${name} ${tail}`;
    }
  }
}

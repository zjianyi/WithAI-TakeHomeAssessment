import * as path from "path";
import * as fs from "fs/promises";
import { createPatch } from "diff";
import type { ApprovalRequestPayload } from "../util/messages";
import type { ChatViewProvider } from "../chat/ChatViewProvider";

let nextId = 1;

const DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

async function safeRead(p: string): Promise<string> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return "";
  }
}

async function buildDiff(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string | null,
): Promise<{ diff: string; filePath?: string } | undefined> {
  if (!DIFF_TOOLS.has(toolName)) return undefined;
  const file =
    (input.file_path as string | undefined) ??
    (input.path as string | undefined) ??
    (input.notebook_path as string | undefined);
  if (!file) return undefined;
  const abs = path.isAbsolute(file) ? file : cwd ? path.join(cwd, file) : file;
  const rel = cwd ? path.relative(cwd, abs) : abs;

  if (toolName === "Write") {
    const next = (input.content as string | undefined) ?? "";
    const prev = await safeRead(abs);
    return { diff: createPatch(rel || file, prev, next, "current", "proposed"), filePath: rel };
  }
  if (toolName === "Edit") {
    const oldStr = (input.old_string as string | undefined) ?? "";
    const newStr = (input.new_string as string | undefined) ?? "";
    const replaceAll = Boolean(input.replace_all);
    const prev = await safeRead(abs);
    let next: string;
    if (oldStr === "") {
      next = newStr;
    } else if (replaceAll) {
      next = prev.split(oldStr).join(newStr);
    } else {
      const idx = prev.indexOf(oldStr);
      next = idx === -1 ? prev : prev.slice(0, idx) + newStr + prev.slice(idx + oldStr.length);
    }
    return { diff: createPatch(rel || file, prev, next, "current", "proposed"), filePath: rel };
  }
  return undefined;
}

type AllowResult = { behavior: "allow"; updatedInput?: Record<string, unknown> };
type DenyResult = { behavior: "deny"; message: string };
export type PermResult = AllowResult | DenyResult;

export class ToolApprovalBridge {
  private pending = new Map<
    string,
    {
      resolve: (r: PermResult) => void;
      timeout: NodeJS.Timeout;
      input: Record<string, unknown>;
    }
  >();

  constructor(
    private readonly provider: ChatViewProvider,
    private readonly cwd: string | null,
  ) {}

  cancelAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeout);
      entry.resolve({ behavior: "deny", message: "User stopped the agent." });
      this.provider.post({ type: "approval-cancelled", id });
    }
    this.pending.clear();
  }

  resolve(id: string, result: PermResult): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    if (result.behavior === "allow") {
      entry.resolve({ behavior: "allow", updatedInput: result.updatedInput ?? entry.input });
    } else {
      entry.resolve(result);
    }
  }

  /** SDK-shaped canUseTool callback. */
  canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal;
      title?: string;
      description?: string;
      toolUseID: string;
    },
  ): Promise<PermResult> => {
    const id = `appr_${nextId++}`;
    const diffInfo = await buildDiff(toolName, input, this.cwd);
    const payload: ApprovalRequestPayload = {
      id,
      toolName,
      toolUseId: options.toolUseID,
      input,
      title: options.title,
      description: options.description,
      diff: diffInfo?.diff,
      filePath: diffInfo?.filePath,
    };

    return new Promise<PermResult>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pending.delete(id)) {
          this.provider.post({ type: "approval-cancelled", id });
          resolve({ behavior: "deny", message: "Approval timed out after 120s." });
        }
      }, 120_000);
      this.pending.set(id, { resolve, timeout, input });

      const abortHandler = () => {
        if (this.pending.delete(id)) {
          clearTimeout(timeout);
          this.provider.post({ type: "approval-cancelled", id });
          resolve({ behavior: "deny", message: "Aborted." });
        }
      };
      if (options.signal.aborted) {
        abortHandler();
        return;
      }
      options.signal.addEventListener("abort", abortHandler, { once: true });

      this.provider.post({ type: "approval-request", payload });
    });
  };
}

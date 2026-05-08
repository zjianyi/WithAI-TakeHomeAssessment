/**
 * Loads project-level context files (CLAUDE.md, AGENTS.md, .cursorrules) from
 * the workspace root and concatenates them for use as `appendSystemPrompt`.
 * Each file is truncated at 8 KB to keep the prompt budget under control.
 */

import * as fs from "fs/promises";
import * as path from "path";

const FILES = ["CLAUDE.md", "AGENTS.md", ".cursorrules"];
const MAX_BYTES = 8 * 1024;

export type LoadedContext = {
  combined: string;
  loaded: { name: string; bytes: number }[];
};

async function readTruncated(p: string): Promise<string | null> {
  try {
    const stat = await fs.stat(p);
    if (!stat.isFile()) return null;
    const fh = await fs.open(p, "r");
    try {
      const buf = Buffer.alloc(Math.min(stat.size, MAX_BYTES));
      await fh.read(buf, 0, buf.length, 0);
      let text = buf.toString("utf8");
      if (stat.size > MAX_BYTES) text += "\n\n[…truncated…]\n";
      return text;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

export async function loadProjectContext(cwd: string | null): Promise<LoadedContext> {
  if (!cwd) return { combined: "", loaded: [] };
  const loaded: { name: string; bytes: number }[] = [];
  const sections: string[] = [];
  for (const name of FILES) {
    const text = await readTruncated(path.join(cwd, name));
    if (!text) continue;
    loaded.push({ name, bytes: Buffer.byteLength(text, "utf8") });
    sections.push(`<!-- ${name} -->\n${text.trim()}`);
  }
  return { combined: sections.join("\n\n---\n\n"), loaded };
}

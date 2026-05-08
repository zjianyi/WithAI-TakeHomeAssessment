/**
 * Builds a compact workspace context (file tree + key-file excerpts) that gets
 * appended to the system prompt every turn. Keeps the model "aware" of the
 * codebase layout without forcing it to call Glob/Read just to find its bearings.
 *
 * - Uses `vscode.workspace.findFiles` for enumeration (respects VS Code's own
 *   file exclusion settings) plus a `.gitignore` pass for repo-specific noise.
 * - Capped at ~10 KB total. Tree depth 4. File count 250.
 * - Pure I/O — caller is responsible for caching + invalidation.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

const TOTAL_BUDGET = 10 * 1024; // ~10 KB output cap
const MAX_FILES = 250;
const MAX_DEPTH = 4;
const KEY_FILE_EXCERPT_BYTES = 800;

const KEY_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "Makefile",
  "requirements.txt",
  "README.md",
  ".env.example",
];

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  "coverage",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  ".idea",
  ".vscode-test",
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".pdf",
  ".zip", ".gz", ".tar", ".tgz", ".bz2", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov", ".avi",
  ".so", ".dylib", ".dll", ".exe", ".bin",
  ".vsix", ".lock",
]);

type GitignoreMatcher = {
  matches: (relPath: string, isDir: boolean) => boolean;
};

/**
 * Tiny `.gitignore` matcher: handles the common subset (literal names, leading
 * `/`, trailing `/`, `*` wildcards, `!` negation, comments, blank lines). This
 * is intentionally not a full parser — we only need to filter out the obvious
 * noise that VS Code's findFiles doesn't already handle. Anything ambiguous
 * falls through (i.e., the file is INCLUDED rather than dropped).
 */
async function loadGitignore(cwd: string): Promise<GitignoreMatcher> {
  let raw = "";
  try {
    raw = await fs.readFile(path.join(cwd, ".gitignore"), "utf8");
  } catch {
    return { matches: () => false };
  }

  type Pattern = { regex: RegExp; dirOnly: boolean; negate: boolean };
  const patterns: Pattern[] = [];

  for (const line0 of raw.split(/\r?\n/)) {
    let line = line0.trim();
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    }
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.startsWith("/");
    if (anchored) line = line.slice(1);
    if (!line) continue;

    // Translate glob → regex (handle ** and *).
    let re = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "*") {
        if (line[i + 1] === "*") {
          re += ".*";
          i++;
        } else {
          re += "[^/]*";
        }
      } else if (c === "?") {
        re += "[^/]";
      } else if (".+^$(){}|[]\\".includes(c)) {
        re += "\\" + c;
      } else {
        re += c;
      }
    }
    const body = anchored ? `^${re}(?:/|$)` : `(?:^|/)${re}(?:/|$)`;
    patterns.push({ regex: new RegExp(body), dirOnly, negate });
  }

  return {
    matches(relPath: string, isDir: boolean): boolean {
      let ignored = false;
      const probe = relPath.replace(/\\/g, "/");
      for (const p of patterns) {
        if (p.dirOnly && !isDir) continue;
        if (p.regex.test(probe)) ignored = !p.negate;
      }
      return ignored;
    },
  };
}

type TreeNode = {
  name: string;
  isDir: boolean;
  size: number;
  children: TreeNode[];
};

function insertPath(root: TreeNode, parts: string[], size: number): void {
  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLeaf = i === parts.length - 1;
    let child = node.children.find((c) => c.name === part);
    if (!child) {
      child = { name: part, isDir: !isLeaf, size: isLeaf ? size : 0, children: [] };
      node.children.push(child);
    }
    node = child;
  }
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderTree(node: TreeNode, depth: number, lines: string[], budget: { left: number }): void {
  if (budget.left <= 0) return;
  if (depth > MAX_DEPTH) {
    if (node.children.length > 0) {
      const indent = "  ".repeat(depth);
      const line = `${indent}…`;
      lines.push(line);
      budget.left -= line.length + 1;
    }
    return;
  }
  // Stable order: dirs first, then files, both alphabetical.
  const sorted = [...node.children].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of sorted) {
    if (budget.left <= 0) {
      lines.push(`${"  ".repeat(depth)}…`);
      return;
    }
    const indent = "  ".repeat(depth);
    if (c.isDir) {
      const line = `${indent}${c.name}/`;
      lines.push(line);
      budget.left -= line.length + 1;
      renderTree(c, depth + 1, lines, budget);
    } else {
      const line = `${indent}${c.name} (${fmtSize(c.size)})`;
      lines.push(line);
      budget.left -= line.length + 1;
    }
  }
}

async function readKeyFile(cwd: string, name: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(path.join(cwd, name), "utf8");
    if (!buf) return null;
    if (buf.length <= KEY_FILE_EXCERPT_BYTES) return buf;
    return buf.slice(0, KEY_FILE_EXCERPT_BYTES) + "\n…[truncated]";
  } catch {
    return null;
  }
}

export type WorkspaceIndex = {
  /** The full appendable string (already formatted). */
  text: string;
  fileCount: number;
  dirCount: number;
  bytes: number;
};

export async function buildWorkspaceContext(cwd: string | null): Promise<WorkspaceIndex | null> {
  if (!cwd) return null;

  const gi = await loadGitignore(cwd);

  // Enumerate everything VS Code's findFiles is willing to expose, then filter.
  // The exclude pattern keeps the noise low at the source.
  const folder = vscode.workspace.workspaceFolders?.[0];
  const includePattern = folder
    ? new vscode.RelativePattern(folder, "**/*")
    : "**/*";
  const excludeGlob = `**/{${[...EXCLUDE_DIRS].join(",")}}/**`;

  let uris: vscode.Uri[] = [];
  try {
    uris = await vscode.workspace.findFiles(includePattern, excludeGlob, MAX_FILES * 4);
  } catch {
    uris = [];
  }

  const root: TreeNode = { name: "", isDir: true, size: 0, children: [] };
  const seenDirs = new Set<string>();
  let fileCount = 0;
  const fileEntries: { rel: string; size: number }[] = [];

  for (const uri of uris) {
    const abs = uri.fsPath;
    const rel = path.relative(cwd, abs);
    if (!rel || rel.startsWith("..")) continue;
    const parts = rel.split(path.sep);
    if (parts.some((p) => EXCLUDE_DIRS.has(p))) continue;
    const ext = path.extname(rel).toLowerCase();
    if (BINARY_EXTS.has(ext)) continue;
    if (gi.matches(rel.replace(/\\/g, "/"), false)) continue;
    // Track parent dirs for the count.
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      if (gi.matches(acc, true)) {
        // Skip ignored dir subtree entirely.
        // Reset rel handling: jump to next URI.
        acc = "__skip__";
        break;
      }
      seenDirs.add(acc);
    }
    if (acc === "__skip__") continue;
    let size = 0;
    try {
      const stat = await fs.stat(abs);
      size = stat.size;
    } catch {
      // best effort
    }
    fileEntries.push({ rel, size });
    fileCount++;
    if (fileCount >= MAX_FILES) break;
  }

  for (const f of fileEntries) {
    insertPath(root, f.rel.split(path.sep), f.size);
  }

  // Build the tree section first (with budget), then key files use whatever's left.
  const treeLines: string[] = ["## Workspace file tree"];
  const treeBudget = { left: Math.floor(TOTAL_BUDGET * 0.55) };
  renderTree(root, 0, treeLines, treeBudget);
  const treeBlock = treeLines.join("\n");

  const keyParts: string[] = [];
  let keyBudget = TOTAL_BUDGET - treeBlock.length - 200; // header padding
  for (const name of KEY_FILES) {
    if (keyBudget <= 100) break;
    const text = await readKeyFile(cwd, name);
    if (!text) continue;
    const slice = text.length > keyBudget - 50 ? text.slice(0, Math.max(0, keyBudget - 60)) + "\n…[truncated]" : text;
    const block = `### ${name}\n${slice}`;
    keyParts.push(block);
    keyBudget -= block.length + 4;
  }

  const keyBlock = keyParts.length > 0 ? `## Key files (excerpts)\n\n${keyParts.join("\n\n")}` : "";

  const text = [treeBlock, keyBlock].filter(Boolean).join("\n\n");

  return {
    text,
    fileCount,
    dirCount: seenDirs.size,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

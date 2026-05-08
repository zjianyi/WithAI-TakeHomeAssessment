import * as path from "path";
import * as vscode from "vscode";
import type { WorkspaceFile } from "./messages";

const EXCLUDE = "**/{node_modules,.git,dist,build,out,.next,.cache,coverage,target,.venv,__pycache__}/**";

export async function findFiles(query: string, max = 30): Promise<WorkspaceFile[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const include = query ? `**/*${query}*` : `**/*`;
  const uris = await vscode.workspace.findFiles(include, EXCLUDE, max * 4);
  const root = folder?.uri.fsPath;
  const list = uris
    .map((u) => {
      const fsPath = u.fsPath;
      const rel = root ? path.relative(root, fsPath) : fsPath;
      return { path: fsPath, rel };
    })
    .filter((f) => !f.rel.startsWith(".."))
    .slice(0, max);
  return list;
}

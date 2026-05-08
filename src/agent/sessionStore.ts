import * as vscode from "vscode";

const PREFIX = "claudeCoder.session.";

function keyFor(workspaceRoot: string | null) {
  return `${PREFIX}${workspaceRoot ?? "_global"}`;
}

export class SessionStore {
  constructor(private readonly memento: vscode.Memento) {}

  workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  get(): string | null {
    return this.memento.get<string | null>(keyFor(this.workspaceRoot()), null);
  }

  async save(id: string | null): Promise<void> {
    await this.memento.update(keyFor(this.workspaceRoot()), id);
  }

  async clear(): Promise<void> {
    await this.save(null);
  }
}

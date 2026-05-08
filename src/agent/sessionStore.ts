import * as vscode from "vscode";

const PREFIX = "claudeCoder.session.";
const PREV_MARK = "claudeCoder.sessionPrev.";

function keyFor(workspaceRoot: string | null) {
  return `${PREFIX}${workspaceRoot ?? "_global"}`;
}

function prevKeyFor(workspaceRoot: string | null) {
  return `${PREV_MARK}${workspaceRoot ?? "_global"}`;
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

  /**
   * Session id from the thread you left when starting a new session (one slot).
   * Use restorePreviousAsCurrent() + SDK `resume` to pick it up again.
   */
  getPrevious(): string | null {
    return this.memento.get<string | null>(prevKeyFor(this.workspaceRoot()), null);
  }

  async setPrevious(id: string | null): Promise<void> {
    await this.memento.update(prevKeyFor(this.workspaceRoot()), id);
  }

  /**
   * Before starting a new agent session: remember the current id so /resume can
   * restore it, then clear the active slot.
   */
  async archiveCurrentForNewSession(): Promise<void> {
    const cur = this.get();
    if (cur) await this.setPrevious(cur);
    await this.clear();
  }

  /**
   * Promote the archived session to the active saved id (next `run()` will
   * `resume` it). Clears the archive slot.
   */
  async restorePreviousAsCurrent(): Promise<string | null> {
    const p = this.getPrevious();
    if (!p) return null;
    await this.save(p);
    await this.setPrevious(null);
    return p;
  }
}

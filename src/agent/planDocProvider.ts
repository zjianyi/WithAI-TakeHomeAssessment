/**
 * TextDocumentContentProvider for the `claude-coder-plan:` URI scheme. Lets the
 * webview "Open in editor" button mirror the streaming/finished plan into a
 * read-only VS Code editor tab — wider real-estate than the sidebar without
 * us having to re-host markdown there.
 */

import * as vscode from "vscode";

export const PLAN_SCHEME = "claude-coder-plan";
export const PLAN_URI = vscode.Uri.parse(`${PLAN_SCHEME}:/Plan.md`);

export class PlanDocProvider implements vscode.TextDocumentContentProvider {
  private _content = "# Plan\n\n_(empty — switch to Plan mode and ask Claude for a plan first.)_";
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  setContent(text: string): void {
    this._content = text || "# Plan\n\n_(empty)_";
    this._onDidChange.fire(PLAN_URI);
  }

  provideTextDocumentContent(): string {
    return this._content;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

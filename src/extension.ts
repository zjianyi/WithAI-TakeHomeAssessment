import * as vscode from "vscode";
import { ChatViewProvider } from "./chat/ChatViewProvider";
import { SecretsStore } from "./auth/secrets";
import { SessionStore } from "./agent/sessionStore";
import { PLAN_SCHEME, PLAN_URI, PlanDocProvider } from "./agent/planDocProvider";

export function activate(context: vscode.ExtensionContext): void {
  const secrets = new SecretsStore(context.secrets);
  const sessionStore = new SessionStore(context.workspaceState);
  const planDocProvider = new PlanDocProvider();
  const provider = new ChatViewProvider(context, secrets, sessionStore, planDocProvider);

  // Debounced workspace-save listener → indexer cache invalidation.
  let saveDebounce: NodeJS.Timeout | null = null;
  const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== "file") return;
    if (saveDebounce) clearTimeout(saveDebounce);
    saveDebounce = setTimeout(() => {
      provider.invalidateContext();
      saveDebounce = null;
    }, 2000);
  });

  context.subscriptions.push(
    saveSub,
    { dispose: () => { if (saveDebounce) clearTimeout(saveDebounce); } },
    planDocProvider,
    vscode.workspace.registerTextDocumentContentProvider(PLAN_SCHEME, planDocProvider),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("claude-coder.openChat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.claude-coder");
      await vscode.commands.executeCommand("claude-coder.chat.focus");
    }),
    vscode.commands.registerCommand("claude-coder.newSession", async () => {
      await provider.newSession();
      void vscode.window.showInformationMessage("Claude Coder: started a new session.");
    }),
    vscode.commands.registerCommand("claude-coder.setApiKey", async () => {
      await secrets.promptAndStore();
      // Re-init the webview with the up-to-date hasApiKey state and current settings.
      await provider.refreshInit();
    }),
    vscode.commands.registerCommand("claude-coder.clearApiKey", async () => {
      await secrets.clear();
      void vscode.window.showInformationMessage("Claude Coder: API key cleared.");
    }),
    vscode.commands.registerCommand("claude-coder.stop", async () => {
      await provider.stop();
    }),
    vscode.commands.registerCommand(
      "claude-coder.openPlanInEditor",
      async (content?: string) => {
        if (typeof content === "string" && content.length > 0) {
          planDocProvider.setContent(content);
        }
        // Prime the document so VS Code recognizes the URI before previewing.
        const doc = await vscode.workspace.openTextDocument(PLAN_URI);
        await vscode.languages.setTextDocumentLanguage(doc, "markdown");
        // Render as a markdown preview pane (themed, headings styled, code highlighted)
        // rather than dropping the user into raw markdown source.
        try {
          await vscode.commands.executeCommand("markdown.showPreviewToSide", PLAN_URI);
        } catch {
          // Fallback if the markdown extension is somehow disabled.
          await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: false,
            preserveFocus: false,
          });
        }
      },
    ),
  );
}

export function deactivate(): void {}

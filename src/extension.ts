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
      const cfg = vscode.workspace.getConfiguration("claudeCoder");
      provider.post({
        type: "init",
        hasApiKey: Boolean(await secrets.get()),
        model: cfg.get<string>("model", "claude-sonnet-4-5"),
        permissionMode: cfg.get<string>("permissionMode", "default"),
        cwd: sessionStore.workspaceRoot(),
        sessionId: sessionStore.get(),
        mode: "agent",
        allowedTools: cfg.get<string[]>("allowedTools", [
          "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch",
        ]),
      });
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
        const doc = await vscode.workspace.openTextDocument(PLAN_URI);
        await vscode.languages.setTextDocumentLanguage(doc, "markdown");
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
          preserveFocus: false,
        });
      },
    ),
  );
}

export function deactivate(): void {}

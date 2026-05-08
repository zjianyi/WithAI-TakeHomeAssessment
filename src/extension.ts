import * as vscode from "vscode";
import { ChatViewProvider } from "./chat/ChatViewProvider";
import { SecretsStore } from "./auth/secrets";
import { SessionStore } from "./agent/sessionStore";

export function activate(context: vscode.ExtensionContext): void {
  const secrets = new SecretsStore(context.secrets);
  const sessionStore = new SessionStore(context.workspaceState);
  const provider = new ChatViewProvider(context, secrets, sessionStore);

  context.subscriptions.push(
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
      provider.post({
        type: "init",
        hasApiKey: Boolean(await secrets.get()),
        model: vscode.workspace.getConfiguration("claudeCoder").get<string>("model", "claude-sonnet-4-5"),
        permissionMode: vscode.workspace
          .getConfiguration("claudeCoder")
          .get<string>("permissionMode", "default"),
        cwd: sessionStore.workspaceRoot(),
        sessionId: sessionStore.get(),
        mode: "agent",
      });
    }),
    vscode.commands.registerCommand("claude-coder.clearApiKey", async () => {
      await secrets.clear();
      void vscode.window.showInformationMessage("Claude Coder: API key cleared.");
    }),
    vscode.commands.registerCommand("claude-coder.stop", async () => {
      await provider.stop();
    }),
  );
}

export function deactivate(): void {}

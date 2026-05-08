import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { AgentRunner } from "../agent/AgentRunner";
import { SecretsStore } from "../auth/secrets";
import { SessionStore } from "../agent/sessionStore";
import { findFiles } from "../util/workspaceFiles";
import type { ToolApprovalBridge } from "../agent/toolApproval";
import type { ExtToWebviewMessage, WebviewToExtMessage } from "../util/messages";

function nonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claude-coder.chat";

  private view?: vscode.WebviewView;
  private runner: AgentRunner;
  private approval: ToolApprovalBridge | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly secrets: SecretsStore,
    private readonly sessionStore: SessionStore,
  ) {
    this.runner = new AgentRunner(this, secrets, sessionStore);
  }

  setApprovalBridge(b: ToolApprovalBridge) {
    this.approval = b;
  }

  post(msg: ExtToWebviewMessage): void {
    this.view?.webview.postMessage(msg);
  }

  async stop(): Promise<void> {
    this.runner.stop();
  }

  async newSession(): Promise<void> {
    await this.runner.newSession();
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "dist");
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [distRoot, vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    view.webview.html = await this.renderHtml(view.webview, distRoot);

    view.webview.onDidReceiveMessage(async (msg: WebviewToExtMessage) => {
      try {
        await this.handle(msg);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        this.post({ type: "info", text: `Error: ${text}` });
      }
    });
  }

  async focus(): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand("claude-coder.chat.focus");
    } else {
      this.view.show?.(true);
    }
  }

  private async sendInit(): Promise<void> {
    const apiKey = await this.secrets.get();
    const cfg = vscode.workspace.getConfiguration("claudeCoder");
    this.post({
      type: "init",
      hasApiKey: Boolean(apiKey),
      model: cfg.get<string>("model", "claude-sonnet-4-5"),
      permissionMode: cfg.get<string>("permissionMode", "default"),
      cwd: this.sessionStore.workspaceRoot(),
      sessionId: this.sessionStore.get(),
    });
  }

  private async handle(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.type) {
      case "webviewReady":
        await this.sendInit();
        return;
      case "send":
        await this.runner.run({ prompt: msg.text });
        return;
      case "stop":
        this.runner.stop();
        return;
      case "approval-response":
        this.approval?.resolve(msg.id, msg.result);
        return;
      case "filesQuery": {
        const files = await findFiles(msg.query);
        this.post({ type: "files", query: msg.query, files });
        return;
      }
      case "newSession":
        await this.runner.newSession();
        return;
      case "setApiKey": {
        await this.secrets.promptAndStore();
        await this.sendInit();
        return;
      }
      case "openFile": {
        const root = this.sessionStore.workspaceRoot();
        const abs = path.isAbsolute(msg.path) ? msg.path : root ? path.join(root, msg.path) : msg.path;
        try {
          const doc = await vscode.workspace.openTextDocument(abs);
          await vscode.window.showTextDocument(doc, { preview: true });
        } catch (err) {
          this.post({ type: "info", text: `Could not open ${msg.path}` });
        }
        return;
      }
      case "openExternal":
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        return;
    }
  }

  private async renderHtml(webview: vscode.Webview, distRoot: vscode.Uri): Promise<string> {
    const indexHtmlPath = vscode.Uri.joinPath(distRoot, "index.html").fsPath;
    if (!fs.existsSync(indexHtmlPath)) {
      return `<!doctype html><html><body style="font-family:system-ui;padding:1rem;background:#1a1a1a;color:#e6e6e6">
        <h3>Claude Coder webview not built</h3>
        <p>Run <code>npm run build</code> in the extension folder, then reload the window.</p>
      </body></html>`;
    }
    let html = await fs.promises.readFile(indexHtmlPath, "utf8");
    const n = nonce();
    const cspSource = webview.cspSource;

    // Rewrite "/assets/..." (Vite default) and "./assets/..." to webview URIs.
    html = html.replace(/(src|href)="\/?(assets\/[^"]+)"/g, (_m, attr: string, p: string) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, p));
      return `${attr}="${uri.toString()}"`;
    });
    html = html.replace(/(src|href)="\.\/(assets\/[^"]+)"/g, (_m, attr: string, p: string) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, p));
      return `${attr}="${uri.toString()}"`;
    });

    html = html.replace(
      /<script /g,
      `<script nonce="${n}" `,
    );

    const csp = [
      `default-src 'none'`,
      `style-src ${cspSource} 'unsafe-inline'`,
      `font-src ${cspSource} data:`,
      `img-src ${cspSource} data: https:`,
      `script-src ${cspSource} 'nonce-${n}'`,
      `connect-src ${cspSource}`,
    ].join("; ");

    if (!html.includes("Content-Security-Policy")) {
      html = html.replace(
        /<head>/,
        `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );
    }
    return html;
  }
}

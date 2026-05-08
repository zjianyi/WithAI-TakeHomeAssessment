import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { AgentRunner } from "../agent/AgentRunner";
import { SecretsStore } from "../auth/secrets";
import { SessionStore } from "../agent/sessionStore";
import { findFiles } from "../util/workspaceFiles";
import type { ToolApprovalBridge } from "../agent/toolApproval";
import type { EffortLevel, ExtToWebviewMessage, WebviewToExtMessage } from "../util/messages";
import { isMode } from "../agent/modes";
import type { PlanDocProvider } from "../agent/planDocProvider";
import { findSlash, slashCommandsMeta, type SlashCtx } from "../agent/slashCommands";

function nonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claude-coder.chat";

  private view?: vscode.WebviewView;
  private runner: AgentRunner;
  private approval: ToolApprovalBridge | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly secrets: SecretsStore,
    private readonly sessionStore: SessionStore,
    private readonly planDocProvider: PlanDocProvider,
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

  /** Called from the debounced workspace save listener in extension.ts. */
  invalidateContext(): void {
    this.runner.invalidateContext();
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

  /** Public entrypoint so external commands (e.g. setApiKey) can re-sync the webview. */
  async refreshInit(): Promise<void> {
    return this.sendInit();
  }

  private async sendInit(): Promise<void> {
    const apiKey = await this.secrets.get();
    const cfg = vscode.workspace.getConfiguration("claudeCoder");
    this.post({
      type: "init",
      hasApiKey: Boolean(apiKey),
      model: cfg.get<string>("model", "claude-sonnet-4-6"),
      permissionMode: cfg.get<string>("permissionMode", "default"),
      cwd: this.sessionStore.workspaceRoot(),
      sessionId: this.sessionStore.get(),
      mode: this.runner.mode(),
      allowedTools: cfg.get<string[]>("allowedTools", DEFAULT_TOOLS),
      effort: cfg.get<EffortLevel>("effort", "high"),
      thinkingEnabled: cfg.get<boolean>("thinking", true),
      slashCommands: slashCommandsMeta(),
    });
  }

  /** Build the SlashCtx that local-type slash commands use to take action. */
  private slashCtx(): SlashCtx {
    return {
      post: (msg) => this.post(msg as ExtToWebviewMessage),
      runAgent: async (prompt: string) => {
        await this.runner.run({ prompt });
      },
      newSession: async () => {
        await this.runner.newSession();
      },
      stop: () => this.runner.stop(),
      lastResult: () => this.runner.lastResult(),
      cwd: () => this.sessionStore.workspaceRoot(),
      sessionId: () => this.runner.sessionId(),
    };
  }

  private async handle(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.type) {
      case "webviewReady":
        await this.sendInit();
        return;
      case "send":
        await this.runner.run({
          prompt: msg.text,
          mode: msg.mode,
          permissionModeOverride: msg.permissionModeOverride,
        });
        return;
      case "setMode":
        if (isMode(msg.mode)) this.runner.setMode(msg.mode);
        return;
      case "setModel":
        await vscode.workspace
          .getConfiguration("claudeCoder")
          .update("model", msg.model, vscode.ConfigurationTarget.Global);
        await this.sendInit();
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
      case "acceptPlan": {
        // Switch the runner into Agent mode so the next turn has the full toolset.
        this.runner.setMode("agent");
        // Fire-and-forget: do NOT await here, otherwise subsequent webview messages
        // (Stop, approval responses, etc.) queue up behind this run's lifecycle.
        const followUp = msg.followUp?.trim();
        const prompt = followUp
          ? `Execute the plan you just produced. Additional instruction: ${followUp}`
          : "Execute the plan you just produced. Proceed step by step. After each numbered step, briefly confirm it's done before moving on.";
        void this.runner.run({
          prompt,
          mode: "agent",
          permissionModeOverride: msg.permissionModeOverride,
        });
        return;
      }
      case "openPlanInEditor": {
        await vscode.commands.executeCommand("claude-coder.openPlanInEditor", msg.content);
        return;
      }
      case "setPermissionBaseline": {
        const cfg = vscode.workspace.getConfiguration("claudeCoder");
        await cfg.update(
          "permissionMode",
          msg.baseline.permissionMode,
          vscode.ConfigurationTarget.Workspace,
        );
        await cfg.update(
          "allowedTools",
          msg.baseline.allowedTools,
          vscode.ConfigurationTarget.Workspace,
        );
        this.post({ type: "permissionBaseline", baseline: msg.baseline });
        this.post({ type: "info", text: "Saved permission baseline to workspace settings." });
        return;
      }
      case "mirrorToTerminal": {
        const root = this.sessionStore.workspaceRoot();
        const term = vscode.window.createTerminal({
          name: "Claude Coder",
          cwd: root ?? undefined,
        });
        term.show(true);
        // sendText with addNewLine=false so the user can edit before pressing Enter,
        // matching Cursor's "open in terminal" behaviour.
        term.sendText(msg.command, false);
        return;
      }
      case "setEffort": {
        await vscode.workspace
          .getConfiguration("claudeCoder")
          .update("effort", msg.effort, vscode.ConfigurationTarget.Workspace);
        this.post({ type: "effortChanged", effort: msg.effort });
        return;
      }
      case "setThinking": {
        await vscode.workspace
          .getConfiguration("claudeCoder")
          .update("thinking", msg.enabled, vscode.ConfigurationTarget.Workspace);
        this.post({ type: "thinkingChanged", enabled: msg.enabled });
        return;
      }
      case "runSlash": {
        const cmd = findSlash(msg.name);
        if (!cmd) {
          this.post({ type: "info", text: `Unknown slash command: /${msg.name}` });
          return;
        }
        if (cmd.type === "local-jsx") {
          this.post({ type: "openPanel", panel: cmd.panel });
          return;
        }
        if (cmd.type === "local") {
          await cmd.run(msg.args, this.slashCtx());
          return;
        }
        // prompt: desugar to an agent run.
        const prompt = cmd.build(msg.args);
        // Fire-and-forget so the message handler returns immediately and other
        // messages (stop, approvals) aren't queued behind this run.
        void this.runner.run({ prompt });
        return;
      }
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

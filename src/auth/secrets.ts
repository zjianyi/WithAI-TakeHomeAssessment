import * as vscode from "vscode";

const KEY = "claudeCoder.anthropicApiKey";

export class SecretsStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  get(): Thenable<string | undefined> {
    return this.secrets.get(KEY);
  }

  set(value: string): Thenable<void> {
    return this.secrets.store(KEY, value);
  }

  clear(): Thenable<void> {
    return this.secrets.delete(KEY);
  }

  /** Prompt the user for their key, store it, and return the value. */
  async promptAndStore(): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
      title: "Anthropic API Key",
      prompt: "Paste an API key starting with sk-ant-… It will be stored in VS Code SecretStorage.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "sk-ant-...",
      validateInput: (v) => {
        if (!v) return "API key is required";
        if (!v.startsWith("sk-ant-")) return "Should start with sk-ant-";
        return null;
      },
    });
    if (!value) return undefined;
    await this.set(value.trim());
    void vscode.window.showInformationMessage("Craig Code: API key saved.");
    return value.trim();
  }
}

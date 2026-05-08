import type { WebviewToExtMessage, ExtToWebviewMessage } from "../../../src/util/messages";

interface VsCodeApi {
  postMessage(msg: WebviewToExtMessage): void;
  setState<T>(state: T): void;
  getState<T>(): T | undefined;
}

declare const acquireVsCodeApi: () => VsCodeApi;

let vscode: VsCodeApi | undefined;
function api(): VsCodeApi {
  if (!vscode) vscode = acquireVsCodeApi();
  return vscode;
}

export function send(msg: WebviewToExtMessage): void {
  api().postMessage(msg);
}

export type Listener = (msg: ExtToWebviewMessage) => void;
const listeners = new Set<Listener>();

window.addEventListener("message", (e) => {
  const data = e.data as ExtToWebviewMessage;
  for (const l of listeners) l(data);
});

export function on(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

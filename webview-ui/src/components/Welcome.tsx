import React from "react";
import { send } from "../lib/vscodeApi";

export function Welcome({ hasApiKey }: { hasApiKey: boolean }) {
  return (
    <div className="welcome">
      <h2>
        <span className="mark">✦</span> Welcome to Craig Code
      </h2>
      <p className="desc">
        An agentic coding assistant powered by the Claude Agent SDK.
      </p>
      {!hasApiKey ? (
        <>
          <p className="desc" style={{ marginTop: 6 }}>
            To get started, set your Anthropic API key. It is stored in VS Code
            SecretStorage and never leaves your machine.
          </p>
          <button className="cta" onClick={() => send({ type: "setApiKey" })}>
            Set Anthropic API Key…
          </button>
        </>
      ) : (
        <>
          <ul>
            <li>Ask me to <code>implement</code>, <code>refactor</code>, or <code>debug</code> code.</li>
            <li>Reference files with <code>@filename</code>.</li>
            <li>Tap <code>+</code> to switch mode: <code>Plan</code> · <code>Debug</code> · <code>Multitask</code> · <code>Ask</code> · <code>Agent</code>.</li>
            <li>Try slash commands: <code>/help</code>, <code>/clear</code>, <code>/new</code>, <code>/cost</code>, <code>/model</code>.</li>
            <li>Drop a <code>CLAUDE.md</code> or <code>AGENTS.md</code> in your repo and I'll read it on every turn.</li>
          </ul>
        </>
      )}
    </div>
  );
}

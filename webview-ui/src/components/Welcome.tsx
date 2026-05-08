import React from "react";
import { send } from "../lib/vscodeApi";

export function Welcome({ hasApiKey }: { hasApiKey: boolean }) {
  return (
    <div className="welcome">
      <h2>
        <span className="mark">✦</span> Welcome to Claude Coder
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
            <li>Try slash commands: <code>/help</code>, <code>/clear</code>, <code>/new</code>, <code>/cost</code>, <code>/model</code>, <code>/resume</code>.</li>
            <li>I'll ask before touching files or running commands.</li>
          </ul>
        </>
      )}
    </div>
  );
}

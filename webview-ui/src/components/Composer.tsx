import React, { useEffect, useRef, useState } from "react";
import { send, on } from "../lib/vscodeApi";
import type { WorkspaceFile } from "../../../src/util/messages";
import { MentionPopup } from "./MentionPopup";

type SlashCmd = { name: string; desc: string };
const SLASH_COMMANDS: SlashCmd[] = [
  { name: "help", desc: "Show available commands" },
  { name: "clear", desc: "Clear the conversation" },
  { name: "new", desc: "Start a new session" },
  { name: "resume", desc: "Resume the last saved session" },
  { name: "cost", desc: "Show last run cost & duration" },
  { name: "model", desc: "Print the current model" },
];

type Props = {
  onSend: (text: string) => void;
  onSlash: (cmd: string) => boolean; // returns true if handled locally
  running: boolean;
  onStop: () => void;
};

type Trigger =
  | { kind: "none" }
  | { kind: "file"; query: string; start: number }
  | { kind: "slash"; query: string; start: number };

export function Composer({ onSend, onSlash, running, onStop }: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [trigger, setTrigger] = useState<Trigger>({ kind: "none" });
  const [active, setActive] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    return on((m) => {
      if (m.type === "files") {
        if (trigger.kind === "file" && trigger.query === m.query) {
          setFiles(m.files);
          setActive(0);
        }
      }
    });
  }, [trigger]);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = "auto";
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 200) + "px";
    }
  }, [text]);

  function detectTrigger(value: string, caret: number): Trigger {
    const pre = value.slice(0, caret);
    // Slash command must be at start (or after newline)
    const slashMatch = /(^|\n)\/(\w*)$/.exec(pre);
    if (slashMatch) {
      const start = caret - slashMatch[2].length - 1;
      return { kind: "slash", query: slashMatch[2], start };
    }
    const m = /(^|[^\w])@([\w./\\-]*)$/.exec(pre);
    if (m) {
      const start = caret - m[2].length - 1;
      return { kind: "file", query: m[2], start };
    }
    return { kind: "none" };
  }

  function handleChange(value: string, caret: number) {
    setText(value);
    const t = detectTrigger(value, caret);
    setTrigger(t);
    setActive(0);
    if (t.kind === "file") {
      send({ type: "filesQuery", query: t.query });
    }
  }

  const filteredSlash = SLASH_COMMANDS.filter((c) =>
    trigger.kind === "slash" ? c.name.startsWith(trigger.query) : true,
  );

  function pickFile(f: WorkspaceFile) {
    if (trigger.kind !== "file" || !taRef.current) return;
    const caret = taRef.current.selectionStart;
    const before = text.slice(0, trigger.start);
    const after = text.slice(caret);
    const insert = `@${f.rel} `;
    const next = before + insert + after;
    setText(next);
    setTrigger({ kind: "none" });
    requestAnimationFrame(() => {
      if (taRef.current) {
        const pos = (before + insert).length;
        taRef.current.focus();
        taRef.current.setSelectionRange(pos, pos);
      }
    });
  }

  function pickSlash(c: SlashCmd) {
    if (trigger.kind !== "slash" || !taRef.current) return;
    const caret = taRef.current.selectionStart;
    const before = text.slice(0, trigger.start);
    const after = text.slice(caret);
    const next = before + `/${c.name}` + after + " ";
    setText(next);
    setTrigger({ kind: "none" });
    requestAnimationFrame(() => {
      if (taRef.current) {
        const pos = (before + `/${c.name} `).length;
        taRef.current.focus();
        taRef.current.setSelectionRange(pos, pos);
      }
    });
  }

  function submit() {
    const t = text.trim();
    if (!t) return;
    if (t.startsWith("/")) {
      const cmd = t.slice(1).split(/\s+/)[0];
      if (onSlash(cmd)) {
        setText("");
        return;
      }
    }
    onSend(t);
    setText("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (trigger.kind !== "none") {
      const list = trigger.kind === "file" ? files.length : filteredSlash.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (list ? (a + 1) % list : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (list ? (a - 1 + list) % list : 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger({ kind: "none" });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (trigger.kind === "file" && files[active]) {
          e.preventDefault();
          pickFile(files[active]);
          return;
        }
        if (trigger.kind === "slash" && filteredSlash[active]) {
          e.preventDefault();
          pickSlash(filteredSlash[active]);
          return;
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape" && running) {
      e.preventDefault();
      onStop();
    }
  }

  return (
    <div className="composer">
      {trigger.kind === "file" && <MentionPopup mode="files" files={files} active={active} onPick={pickFile} />}
      {trigger.kind === "slash" && (
        <MentionPopup mode="slash" commands={filteredSlash} active={active} onPick={pickSlash} />
      )}
      <div className="row">
        <textarea
          ref={taRef}
          rows={1}
          placeholder={running ? "Agent is running… Esc to stop" : "Ask anything (use @ to reference files, / for commands)"}
          value={text}
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button className="stop" onClick={onStop} title="Stop">
            Stop
          </button>
        ) : (
          <button className="send" onClick={submit} disabled={!text.trim()} title="Send (Enter)">
            Send
          </button>
        )}
      </div>
      <div className="hint">
        <span>
          <kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline · <kbd>@</kbd> file · <kbd>/</kbd> command
        </span>
        <span>{running ? "running…" : ""}</span>
      </div>
    </div>
  );
}

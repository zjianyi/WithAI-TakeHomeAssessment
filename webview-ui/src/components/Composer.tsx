import React, { useEffect, useRef, useState } from "react";
import { send, on } from "../lib/vscodeApi";
import type { Mode, PermissionOverride, WorkspaceFile } from "../../../src/util/messages";
import { MentionPopup } from "./MentionPopup";
import { ModePicker, MODE_LABEL } from "./ModePicker";
import { PermPill } from "./PermPill";

type SlashCmd = { name: string; desc: string };
const SLASH_COMMANDS: SlashCmd[] = [
  { name: "help", desc: "Show available commands" },
  { name: "clear", desc: "Clear the conversation" },
  { name: "new", desc: "Start a new session" },
  { name: "resume", desc: "Resume the last saved session" },
  { name: "cost", desc: "Show last run cost & duration" },
  { name: "model", desc: "Print the current model" },
  { name: "plan", desc: "Re-open the plan view (if any)" },
];

const MODELS = [
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

type Props = {
  onSend: (text: string, mode?: Mode, permission?: PermissionOverride) => void;
  onSlash: (cmd: string) => boolean;
  running: boolean;
  onStop: () => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  model: string;
  onModelChange: (m: string) => void;
  /** The workspace baseline (informs the pill's "overridden" highlight). */
  permissionBaseline: PermissionOverride;
};

type Trigger =
  | { kind: "none" }
  | { kind: "file"; query: string; start: number }
  | { kind: "slash"; query: string; start: number };

export function Composer({
  onSend,
  onSlash,
  running,
  onStop,
  mode,
  onModeChange,
  model,
  onModelChange,
  permissionBaseline,
}: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [trigger, setTrigger] = useState<Trigger>({ kind: "none" });
  const [active, setActive] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [permLevel, setPermLevel] = useState<PermissionOverride>(permissionBaseline);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPermLevel(permissionBaseline);
  }, [permissionBaseline]);

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

  useEffect(() => {
    if (!modelOpen) return;
    function onDoc(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModelOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelOpen]);

  function detectTrigger(value: string, caret: number): Trigger {
    const pre = value.slice(0, caret);
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
    onSend(t, mode, permLevel);
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

  const placeholder = running
    ? "Agent is running… Esc to stop"
    : mode === "plan"
      ? "Plan first — what do you want me to build?"
      : mode === "ask"
        ? "Ask Claude anything…"
        : mode === "multitask"
          ? "Describe work that can run in parallel…"
          : mode === "debug"
            ? "What's the bug?"
            : "Ask Claude to edit…";

  const currentModel = MODELS.find((m) => m.id === model)?.label ?? model;
  const showModePill = mode !== "agent";

  return (
    <div className="composer">
      {trigger.kind === "file" && (
        <MentionPopup mode="files" files={files} active={active} onPick={pickFile} />
      )}
      {trigger.kind === "slash" && (
        <MentionPopup mode="slash" commands={filteredSlash} active={active} onPick={pickSlash} />
      )}

      <div className="composer-shell">
        <textarea
          ref={taRef}
          rows={1}
          className="composer-textarea"
          placeholder={placeholder}
          value={text}
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-controls">
          <div className="left">
            <div className="plus-wrap">
              <button
                className="plus"
                onClick={() => setPickerOpen((v) => !v)}
                title="Modes & tools"
                aria-label="Open modes and tools"
              >
                +
              </button>
              <ModePicker
                open={pickerOpen}
                active={mode}
                onPick={onModeChange}
                onClose={() => setPickerOpen(false)}
              />
            </div>

            {showModePill && (
              <span className={`mode-pill mode-${mode}`}>
                <span className="mode-pill-label">{MODE_LABEL[mode]}</span>
                <button
                  className="mode-pill-x"
                  onClick={() => onModeChange("agent")}
                  title="Switch back to Agent"
                  aria-label="Clear mode"
                >
                  ×
                </button>
              </span>
            )}

            <PermPill
              level={permLevel}
              baseline={permissionBaseline}
              onChange={setPermLevel}
            />

            <div className="model-wrap" ref={modelRef}>
              <button
                className="model-btn"
                onClick={() => setModelOpen((v) => !v)}
                title="Switch model"
              >
                <span className="model-glyph">✱</span>
                {currentModel}
                <span className="caret">▾</span>
              </button>
              {modelOpen && (
                <div className="model-menu" role="menu">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      className={`model-item${m.id === model ? " active" : ""}`}
                      onClick={() => {
                        onModelChange(m.id);
                        setModelOpen(false);
                      }}
                    >
                      {m.label}
                      {m.id === model && <span className="mp-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="right">
            <button
              className="mic"
              disabled
              title="Voice — coming soon"
              aria-label="Voice input (coming soon)"
            >
              🎤
            </button>
            {running ? (
              <button className="send-round stop" onClick={onStop} title="Stop">
                ■
              </button>
            ) : (
              <button
                className="send-round"
                onClick={submit}
                disabled={!text.trim()}
                title="Send (Enter)"
                aria-label="Send"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

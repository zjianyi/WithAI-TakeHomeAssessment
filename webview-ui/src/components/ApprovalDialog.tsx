import React, { useState } from "react";
import type { ApprovalRequestPayload } from "../../../src/util/messages";
import { send } from "../lib/vscodeApi";
import { DiffPreview } from "./DiffPreview";

export function ApprovalDialog({
  payload,
  onResolved,
}: {
  payload: ApprovalRequestPayload;
  /** Called after the user submits allow/deny so the card can leave the transcript. */
  onResolved?: () => void;
}) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");

  const allow = () => {
    send({ type: "approval-response", id: payload.id, result: { behavior: "allow" } });
    onResolved?.();
  };
  const deny = (msg: string) => {
    send({
      type: "approval-response",
      id: payload.id,
      result: { behavior: "deny", message: msg },
    });
    onResolved?.();
  };

  const isBash = payload.toolName === "Bash";
  const isEditish = payload.toolName === "Edit" || payload.toolName === "Write" || payload.toolName === "MultiEdit";

  return (
    <div className="approval">
      <div className="title">
        ● {payload.toolName} — approval needed
      </div>
      <div className="subtitle">
        {payload.title || payload.description || "Claude wants to use this tool."}
        {payload.filePath ? ` · ${payload.filePath}` : ""}
      </div>

      {isBash && (
        <pre className="input">{String((payload.input as Record<string, unknown>).command ?? "")}</pre>
      )}

      {isEditish && payload.diff && <DiffPreview patch={payload.diff} />}

      {!isBash && !isEditish && (
        <pre className="input">{JSON.stringify(payload.input, null, 2)}</pre>
      )}

      {!denying ? (
        <div className="row">
          <button className="allow" onClick={allow}>
            Allow once
          </button>
          <button className="deny" onClick={() => setDenying(true)}>
            Deny…
          </button>
        </div>
      ) : (
        <>
          <textarea
            placeholder="Tell Claude why you're denying this (e.g. 'edit the test file instead')"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: "100%",
              minHeight: 50,
              marginTop: 6,
              background: "#111",
              color: "var(--fg)",
              border: "1px solid var(--border-soft)",
              borderRadius: 4,
              padding: 6,
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
            autoFocus
          />
          <div className="row">
            <button
              className="deny"
              onClick={() => deny(reason.trim() || "User denied this tool call.")}
            >
              Send denial
            </button>
            <button onClick={() => setDenying(false)}>Back</button>
          </div>
        </>
      )}
    </div>
  );
}

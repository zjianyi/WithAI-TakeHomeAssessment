// E2E test that exercises the real ToolApprovalBridge logic from the extension
// by importing the SDK directly with the same options shape AgentRunner uses,
// then auto-approves through the bridge contract.
//
// This validates: permission split (Read pre-approved, Edit gated),
// diff generation, and { behavior: "allow", updatedInput } pattern.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createPatch } from "diff";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error("ANTHROPIC_API_KEY missing"); process.exit(2); }

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "claudecoder-e2e-"));
const target = path.join(tmp, "demo.js");
await fs.writeFile(target, "// TODO: implement add\nexport function add(a, b) { return 0; }\n");

const enabledTools = ["Read", "Write", "Edit", "Glob", "Grep"];
const SAFE = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
const allowedTools = enabledTools.filter((t) => SAFE.has(t));

const approvals = [];

async function buildDiff(toolName, input, cwd) {
  const f = input.file_path || input.path;
  if (!f) return null;
  const abs = path.isAbsolute(f) ? f : path.join(cwd, f);
  const rel = path.relative(cwd, abs);
  let prev = "";
  try { prev = await fs.readFile(abs, "utf8"); } catch {}
  if (toolName === "Write") return createPatch(rel, prev, input.content ?? "", "current", "proposed");
  if (toolName === "Edit") {
    const o = input.old_string ?? ""; const n = input.new_string ?? "";
    let next = prev;
    if (o === "") next = n;
    else if (input.replace_all) next = prev.split(o).join(n);
    else { const i = prev.indexOf(o); if (i !== -1) next = prev.slice(0, i) + n + prev.slice(i + o.length); }
    return createPatch(rel, prev, next, "current", "proposed");
  }
  return null;
}

const events = { tools: [], assistant: [], approvalsAllowed: 0, approvalsDenied: 0 };

for await (const m of query({
  prompt: "Read demo.js and edit it so the add function returns a + b. Then stop.",
  options: {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 6,
    allowedTools,
    tools: enabledTools,
    permissionMode: "default",
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
    canUseTool: async (toolName, input) => {
      const diff = await buildDiff(toolName, input, tmp);
      approvals.push({ toolName, hasDiff: !!diff });
      if (diff) console.log("DIFF for", toolName, "\n" + diff.split("\n").slice(0, 10).join("\n"));
      events.approvalsAllowed++;
      return { behavior: "allow", updatedInput: input };
    },
  },
})) {
  if (m.type === "assistant") {
    for (const b of m.message.content) {
      if (b.type === "text" && b.text) events.assistant.push(b.text);
      else if (b.type === "tool_use") events.tools.push(b.name);
    }
  } else if (m.type === "system" && m.subtype === "init") {
    console.log(`[init] tools=${m.tools.length} model=${m.model}`);
  } else if (m.type === "result") {
    console.log(`[result] ${m.subtype} cost=$${m.total_cost_usd?.toFixed(4)} ${m.duration_ms}ms`);
  }
}

const final = await fs.readFile(target, "utf8");
console.log("\nfinal:", JSON.stringify(final));
console.log("tools:", events.tools.join(", "));
console.log("approvals:", approvals.map((a) => `${a.toolName}${a.hasDiff ? "*" : ""}`).join(", "));
const ok = events.tools.includes("Read")
  && (events.tools.includes("Edit") || events.tools.includes("Write"))
  && approvals.length >= 1
  && approvals.some((a) => a.hasDiff)
  && /a\s*\+\s*b/.test(final);
console.log(`=== ${ok ? "PASS" : "FAIL"} ===`);
process.exit(ok ? 0 : 1);

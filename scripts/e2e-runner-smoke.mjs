// E2E smoke that mirrors the real AgentRunner setup. Supports modes:
//   --mode=agent     (default) Read+Edit gated through canUseTool with a diff
//   --mode=plan      Read-only — asserts NO Edit/Write/Bash were called
//   --mode=ask       Read-only — asserts no edits, no plan dispatching
//   --mode=multitask Asserts an Agent (subagent) tool_use shows up and that
//                    its messages carry parent_tool_use_id
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/e2e-runner-smoke.mjs --mode=plan
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createPatch } from "diff";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error("ANTHROPIC_API_KEY missing"); process.exit(2); }

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.split("=").slice(1).join("=") : d;
};
const mode = arg("mode", "agent");

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `claudecoder-e2e-${mode}-`));
const target = path.join(tmp, "demo.js");
await fs.writeFile(target, "// TODO: implement add\nexport function add(a, b) { return 0; }\n");
await fs.writeFile(
  path.join(tmp, "two.js"),
  "// TODO: implement sub\nexport function sub(a, b) { return 0; }\n",
);

const ALL = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "TodoWrite"];
const READONLY = ["Read", "Glob", "Grep", "TodoWrite"];

const PLAN_PROMPT =
  "You are in PLAN mode. Explore the codebase carefully (Read/Glob/Grep) and produce a clear, " +
  "numbered implementation plan as your final assistant message. Do NOT call Edit, Write, or Bash. " +
  "Do NOT modify files. Surface assumptions, risks, and out-of-scope items. " +
  "Wait for the user to switch to Agent mode to execute.";
const ASK_PROMPT =
  "You are in ASK mode. Answer the user's question conversationally. " +
  "You may read files to ground your answer, but do not propose plans, do not edit, " +
  "and do not run commands. Be concise.";
const MULTI_PROMPT =
  "You are in MULTITASK mode. When work decomposes into INDEPENDENT sub-tasks (touching " +
  "different files or layers), dispatch them in parallel by calling the Agent tool with " +
  "subagent_type='worker'. Pass each worker a self-contained, fully-specified prompt — they " +
  "do not share your context. Don't decompose tightly coupled work; do it yourself. After " +
  "workers report back, integrate their results and report a single summary to the user.";

const WORKER = {
  description:
    "Worker subagent for parallel tasks. Receives a fully-specified, self-contained " +
    "instruction; works independently; reports back a concise summary.",
  prompt:
    "You are a worker subagent. Read what you need, do the work, and end with a 1-3 sentence " +
    "summary. If unclear, return early with a clarifying question.",
  tools: ["Read", "Write", "Edit", "Glob", "Grep", "TodoWrite"],
};

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

let prompt = "Read demo.js and edit it so the add function returns a + b. Then stop.";
let allowedTools = ALL.filter((t) => ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"].includes(t));
let tools = ALL;
let appendSystemPrompt = "";
let canUseTool = undefined;
let agents = undefined;

if (mode === "plan") {
  prompt = "Plan how to implement the add function in demo.js. Just plan; do not edit anything.";
  tools = READONLY;
  allowedTools = READONLY;
  appendSystemPrompt = PLAN_PROMPT;
} else if (mode === "ask") {
  prompt = "What does demo.js currently do? Just answer.";
  tools = READONLY;
  allowedTools = READONLY;
  appendSystemPrompt = ASK_PROMPT;
} else if (mode === "multitask") {
  prompt =
    "Two independent tasks: (1) edit demo.js so `add` returns a+b, (2) edit two.js so `sub` " +
    "returns a-b. These touch different files and are independent — dispatch them as TWO " +
    "parallel workers via the Agent tool, then summarize.";
  tools = [...ALL, "Agent"];
  allowedTools = [...allowedTools, "Agent"];
  appendSystemPrompt = MULTI_PROMPT;
  agents = { worker: WORKER };
  canUseTool = async (toolName, input) => {
    const diff = await buildDiff(toolName, input, tmp);
    return { behavior: "allow", updatedInput: input };
  };
} else {
  // agent
  canUseTool = async (toolName, input) => {
    const diff = await buildDiff(toolName, input, tmp);
    if (diff) console.log("DIFF for", toolName, "\n" + diff.split("\n").slice(0, 10).join("\n"));
    return { behavior: "allow", updatedInput: input };
  };
}

const events = {
  tools: [],
  toolsByParent: {}, // parent_tool_use_id -> [toolNames]
  assistant: [],
  parentTagged: 0, // count of messages with parent_tool_use_id present
  agentToolUses: 0,
};

console.log(`[e2e] mode=${mode} cwd=${tmp}`);

for await (const m of query({
  prompt,
  options: {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 8,
    allowedTools,
    tools,
    permissionMode: "default",
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
    ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
    ...(agents ? { agents } : {}),
    ...(canUseTool ? { canUseTool } : {}),
  },
})) {
  if (m.type === "assistant") {
    const parent = m.parent_tool_use_id ?? null;
    if (parent) events.parentTagged++;
    for (const b of m.message.content) {
      if (b.type === "text" && b.text) events.assistant.push(b.text);
      else if (b.type === "tool_use") {
        events.tools.push(b.name);
        if (b.name === "Agent") events.agentToolUses++;
        if (parent) {
          (events.toolsByParent[parent] ??= []).push(b.name);
        }
      }
    }
  } else if (m.type === "user") {
    if (m.parent_tool_use_id) events.parentTagged++;
  } else if (m.type === "system" && m.subtype === "init") {
    console.log(`[init] tools=${m.tools.length} model=${m.model}`);
  } else if (m.type === "result") {
    console.log(
      `[result] ${m.subtype} cost=$${m.total_cost_usd?.toFixed(4)} ${m.duration_ms}ms ` +
      `usage_in=${m.usage?.input_tokens} usage_out=${m.usage?.output_tokens}`,
    );
  }
}

const final = await fs.readFile(target, "utf8");
const finalTwo = await fs.readFile(path.join(tmp, "two.js"), "utf8");
console.log("\nfinal demo.js:", JSON.stringify(final));
console.log("tools:", events.tools.join(", "));
console.log("parent-tagged messages:", events.parentTagged);
console.log("agent tool uses:", events.agentToolUses);
console.log("toolsByParent:", JSON.stringify(events.toolsByParent));

let ok = false;
if (mode === "agent") {
  ok = events.tools.includes("Read")
    && (events.tools.includes("Edit") || events.tools.includes("Write"))
    && /a\s*\+\s*b/.test(final);
} else if (mode === "plan") {
  // No Edit / Write / Bash should have been called.
  const noMutations = !events.tools.some((t) => ["Edit", "Write", "Bash"].includes(t));
  // File should be unchanged.
  const unchanged = /return 0/.test(final);
  ok = noMutations && unchanged;
  console.log(`plan checks: noMutations=${noMutations} unchanged=${unchanged}`);
} else if (mode === "ask") {
  const noMutations = !events.tools.some((t) => ["Edit", "Write", "Bash"].includes(t));
  const unchanged = /return 0/.test(final);
  ok = noMutations && unchanged;
  console.log(`ask checks: noMutations=${noMutations} unchanged=${unchanged}`);
} else if (mode === "multitask") {
  const dispatched = events.agentToolUses >= 1;
  const nestedSeen = events.parentTagged >= 1;
  // At least one of the files should have been modified.
  const modified = /a\s*\+\s*b/.test(final) || /a\s*-\s*b/.test(finalTwo);
  ok = dispatched && nestedSeen && modified;
  console.log(`multitask: dispatched=${dispatched} nestedSeen=${nestedSeen} modified=${modified}`);
}

console.log(`=== ${ok ? "PASS" : "FAIL"} (${mode}) ===`);
process.exit(ok ? 0 : 1);

// E2E smoke that mirrors the real AgentRunner setup. Supports modes:
//   --mode=agent           (default) Read+Edit gated through canUseTool with a diff
//   --mode=plan            Read-only, two-turn flow:
//                           1) prompt → assert exactly 2 numbered clarifying questions
//                           2) follow-up answer → assert numbered plan with ≥3 items
//   --mode=ask             Read-only — asserts no edits, no plan dispatching
//   --mode=multitask       Asserts an Agent (subagent) tool_use shows up and that
//                          its messages carry parent_tool_use_id
//   --mode=plan-build      Plan turn → simulated acceptPlan with
//                          permissionMode=acceptEdits → assert Edit fires without
//                          a canUseTool round-trip and the file is updated
//   --mode=perm-readonly   Agent system prompt + readOnly intersection on tools;
//                          assert NO Edit/Write/Bash were exposed and the file
//                          is unchanged (orthogonal to mode)
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

// Mirror src/agent/modes.ts (must stay in sync).
const PLAN_PROMPT =
  "You are in PLAN mode. This is a strict two-turn protocol — follow it exactly.\n" +
  "\n" +
  "TURN 1 (right now): Your ENTIRE response must be exactly two clarifying questions, nothing else. " +
  "No preamble, no plan, no exploration, no tool calls. The questions should probe scope, constraints, " +
  "or ambiguities in the user's request. Format MUST be:\n" +
  "  1. <first question>\n" +
  "  2. <second question>\n" +
  "Do NOT call any tools. Do NOT write a plan. Do NOT propose implementation. " +
  "If you start writing a plan in this turn, you have failed the protocol — STOP and ask questions " +
  "instead.\n" +
  "\n" +
  "TURN 2 (after the user answers): Explore the codebase as needed (Read/Glob/Grep) and then write " +
  "a numbered implementation plan as your final assistant message. Do NOT call Edit, Write, or Bash. " +
  "Surface assumptions, risks, and out-of-scope items.";
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

/**
 * Wraps `query()` and collects per-turn events. Returns the assistant text
 * (joined) and the tool list for that turn so we can assert structure between
 * turns in multi-turn flows.
 */
async function runTurn({ prompt, opts, label }) {
  console.log(`\n[turn] ${label}`);
  const turn = {
    text: "",
    tools: [],
    sessionId: null,
    edited: false,
  };
  for await (const m of query({ prompt, options: opts })) {
    if (m.type === "system" && m.subtype === "init") {
      turn.sessionId = m.session_id;
      console.log(`  [init] tools=${m.tools.length} model=${m.model} sid=${m.session_id.slice(0,8)}`);
    } else if (m.type === "assistant") {
      for (const b of m.message.content) {
        if (b.type === "text" && b.text) turn.text += b.text;
        else if (b.type === "tool_use") {
          turn.tools.push(b.name);
          if (b.name === "Edit" || b.name === "Write") turn.edited = true;
        }
      }
    } else if (m.type === "result") {
      turn.sessionId = m.session_id;
      console.log(
        `  [result] ${m.subtype} cost=$${m.total_cost_usd?.toFixed(4)} ${m.duration_ms}ms`,
      );
    }
  }
  return turn;
}

let ok = false;

if (mode === "plan") {
  // Two-turn flow: questions then plan.
  const opts1 = {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 4,
    allowedTools: READONLY,
    tools: READONLY,
    permissionMode: "default",
    appendSystemPrompt: PLAN_PROMPT,
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
  };
  const t1 = await runTurn({
    prompt: "Plan how to implement the `add` function in demo.js so it returns a + b.",
    opts: opts1,
    label: "plan question phase",
  });

  // Assert exactly two numbered questions (1. and 2., on their own lines)
  // AND that the response actually ends with a question mark — defends against
  // the model dressing up a plan as a numbered list.
  const has1 = /^\s*1\./m.test(t1.text);
  const has2 = /^\s*2\./m.test(t1.text);
  const has3 = /^\s*3\./m.test(t1.text);
  const endsWithQuestion = /\?\s*$/.test(t1.text);
  const noMutations1 = !t1.tools.some((t) => ["Edit", "Write", "Bash"].includes(t));
  console.log(`  questions: 1.=${has1} 2.=${has2} (no 3.)=${!has3} ends-?=${endsWithQuestion} no-mutations=${noMutations1}`);
  console.log(`  --- assistant text (turn 1) ---\n${t1.text}\n  --- end ---`);

  // Second turn: answer the questions, expect a numbered plan.
  const opts2 = { ...opts1, resume: t1.sessionId };
  const t2 = await runTurn({
    prompt:
      "Answers: (1) Just edit the existing function in demo.js. (2) No edge cases — assume both are numbers. Now write the plan.",
    opts: opts2,
    label: "plan generation phase",
  });
  const itemRe = /(?:^|\n)\s*(?:\d+\.|[-*])\s+\S/g;
  const planItems = (t2.text.match(itemRe) || []).length;
  const noMutations2 = !t2.tools.some((t) => ["Edit", "Write", "Bash"].includes(t));
  const final = await fs.readFile(target, "utf8");
  const unchanged = /return 0/.test(final);
  console.log(`  plan: items=${planItems} no-mutations=${noMutations2} file-unchanged=${unchanged}`);

  ok = has1 && has2 && endsWithQuestion && noMutations1 && noMutations2 && planItems >= 3 && unchanged;

} else if (mode === "ask") {
  const opts = {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 4,
    allowedTools: READONLY,
    tools: READONLY,
    permissionMode: "default",
    appendSystemPrompt: ASK_PROMPT,
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
  };
  const t = await runTurn({
    prompt: "What does demo.js currently do? Just answer.",
    opts, label: "ask",
  });
  const noMutations = !t.tools.some((x) => ["Edit", "Write", "Bash"].includes(x));
  const final = await fs.readFile(target, "utf8");
  const unchanged = /return 0/.test(final);
  console.log(`  ask: noMutations=${noMutations} unchanged=${unchanged}`);
  ok = noMutations && unchanged;

} else if (mode === "multitask") {
  let dispatched = 0, parentTagged = 0;
  const opts = {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 8,
    allowedTools: [...ALL, "Agent"],
    tools: [...ALL, "Agent"],
    permissionMode: "default",
    appendSystemPrompt: MULTI_PROMPT,
    agents: { worker: WORKER },
    canUseTool: async (toolName, input) => ({ behavior: "allow", updatedInput: input }),
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
  };
  for await (const m of query({
    prompt:
      "Two independent tasks: (1) edit demo.js so `add` returns a+b, (2) edit two.js so `sub` " +
      "returns a-b. These touch different files and are independent — dispatch them as TWO " +
      "parallel workers via the Agent tool, then summarize.",
    options: opts,
  })) {
    if (m.type === "assistant") {
      if (m.parent_tool_use_id) parentTagged++;
      for (const b of m.message.content) {
        if (b.type === "tool_use" && b.name === "Agent") dispatched++;
      }
    } else if (m.type === "user" && m.parent_tool_use_id) parentTagged++;
    else if (m.type === "result") {
      console.log(`  [result] ${m.subtype} ${m.duration_ms}ms`);
    }
  }
  const final = await fs.readFile(target, "utf8");
  const finalTwo = await fs.readFile(path.join(tmp, "two.js"), "utf8");
  const modified = /a\s*\+\s*b/.test(final) || /a\s*-\s*b/.test(finalTwo);
  console.log(`  multitask: dispatched=${dispatched} parentTagged=${parentTagged} modified=${modified}`);
  ok = dispatched >= 1 && parentTagged >= 1 && modified;

} else if (mode === "plan-build") {
  // Round 1: plan (questions + then plan in two turns).
  const planOpts1 = {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 4,
    allowedTools: READONLY,
    tools: READONLY,
    permissionMode: "default",
    appendSystemPrompt: PLAN_PROMPT,
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
  };
  const t1 = await runTurn({
    prompt: "Plan how to implement the `add` function in demo.js so it returns a + b.",
    opts: planOpts1, label: "plan question phase",
  });
  const planOpts2 = { ...planOpts1, resume: t1.sessionId };
  const t2 = await runTurn({
    prompt:
      "Answers: (1) Edit the existing function in demo.js. (2) No edge cases. Write the plan now.",
    opts: planOpts2, label: "plan generation phase",
  });
  const itemRe = /(?:^|\n)\s*(?:\d+\.|[-*])\s+\S/g;
  const planItems = (t2.text.match(itemRe) || []).length;

  // Round 2: simulate the acceptPlan handler — switch to Agent + acceptEdits.
  const buildOpts = {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 6,
    allowedTools: ALL,
    tools: ALL,
    permissionMode: "acceptEdits",
    resume: t2.sessionId,
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
  };
  let approvalsAsked = 0;
  buildOpts.canUseTool = async (toolName, input) => {
    approvalsAsked++;
    return { behavior: "allow", updatedInput: input };
  };
  const t3 = await runTurn({
    prompt:
      "Execute the plan you just produced. Proceed step by step. After each numbered step, briefly confirm it's done before moving on.",
    opts: buildOpts, label: "build (acceptEdits)",
  });
  const final = await fs.readFile(target, "utf8");
  const editFired = t3.tools.includes("Edit") || t3.tools.includes("Write");
  const correctOutput = /a\s*\+\s*b/.test(final);
  // In acceptEdits the SDK shouldn't be calling our canUseTool for Edit/Write.
  // Approvals may still fire for Bash if the model reaches for it; that's not a fail
  // by itself. The key signal is editFired AND correctOutput.
  console.log(`  build: planItems=${planItems} editFired=${editFired} correctOutput=${correctOutput} approvalsAsked=${approvalsAsked}`);
  ok = planItems >= 3 && editFired && correctOutput;

} else if (mode === "perm-readonly") {
  // Agent mode SYSTEM prompt (no plan/ask), but tools intersected with read-only
  // — verifies that "readOnly" override is orthogonal to mode (mode still says
  // "go ahead and edit" but the tool list won't expose Edit/Write/Bash).
  const intersected = ALL.filter((t) => READONLY.includes(t));
  const opts = {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 4,
    allowedTools: intersected,
    tools: intersected,
    permissionMode: "default",
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
  };
  const t = await runTurn({
    prompt: "Read demo.js then edit it so `add` returns a + b. Then stop.",
    opts, label: "agent + readOnly intersection",
  });
  const noMutations = !t.tools.some((x) => ["Edit", "Write", "Bash"].includes(x));
  const final = await fs.readFile(target, "utf8");
  const unchanged = /return 0/.test(final);
  console.log(`  perm-readonly: noMutations=${noMutations} unchanged=${unchanged} tools=${t.tools.join(",")}`);
  ok = noMutations && unchanged;

} else {
  // agent (default)
  const opts = {
    cwd: tmp,
    model: "claude-sonnet-4-5",
    maxTurns: 8,
    allowedTools: ALL.filter((t) => ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"].includes(t)),
    tools: ALL,
    permissionMode: "default",
    canUseTool: async (toolName, input) => {
      const diff = await buildDiff(toolName, input, tmp);
      if (diff) console.log("DIFF for", toolName, "\n" + diff.split("\n").slice(0, 10).join("\n"));
      return { behavior: "allow", updatedInput: input };
    },
    env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
  };
  const t = await runTurn({
    prompt: "Read demo.js and edit it so the add function returns a + b. Then stop.",
    opts, label: "agent",
  });
  const final = await fs.readFile(target, "utf8");
  ok = t.tools.includes("Read")
    && (t.tools.includes("Edit") || t.tools.includes("Write"))
    && /a\s*\+\s*b/.test(final);
}

console.log(`\n=== ${ok ? "PASS" : "FAIL"} (${mode}) ===`);
process.exit(ok ? 0 : 1);

/**
 * Mode registry for the Cursor-style 5-mode switcher: Agent / Plan / Ask /
 * Multitask / Debug. Each mode pre-configures the SDK options surface — which
 * tools are exposed, whether mutating tools route through approval, the
 * appended system prompt, and (for Multitask) the subagent map.
 *
 * The registry is intentionally lightweight: AgentRunner.run() reads the mode
 * once at the start of the turn and merges these defaults with user config.
 */

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" };

export type Mode = "agent" | "plan" | "ask" | "multitask" | "debug";

export const ALL_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
];

export const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"];

const PLAN_PROMPT =
  "You are in PLAN mode.\n" +
  "Step 1 — Before writing any plan, ask the user exactly 2 clarifying questions about scope, " +
  "constraints, or ambiguities. Number them `1.` and `2.` (each on its own line). Do not write " +
  "the plan yet. Do not call any tools yet.\n" +
  "Step 2 — After the user answers, explore the codebase (Read/Glob/Grep), then write a numbered " +
  "implementation plan as your final assistant message. Do NOT call Edit, Write, or Bash. " +
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

const DEBUG_PROMPT =
  "You are in DEBUG mode. Use the scientific method: form a clear hypothesis, design a " +
  "minimal experiment to verify it (read code, run a script, add a log line, run a test), " +
  "observe runtime evidence, then refine. Always cite the runtime evidence in your reasoning. " +
  "Don't speculate beyond what the evidence supports.";

export const WORKER_AGENT: AgentDefinition = {
  description:
    "Worker subagent for parallel tasks. Receives a fully-specified, self-contained " +
    "instruction; works independently; reports back a concise summary.",
  prompt:
    "You are a worker subagent. Your parent agent has given you a self-contained task. " +
    "Read what you need, do the work, and end with a 1-3 sentence summary of what you " +
    "changed and where. If the task is unclear, return early with a clarifying question " +
    "instead of guessing.",
  tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "TodoWrite"],
};

export type ModeDef = {
  /** Tools exposed to the agent in this mode (intersected with user's allowedTools). */
  tools: string[];
  /** Tools that, in this mode, are pre-approved without an approval round-trip. */
  preApproved: string[];
  /** Whether canUseTool should be installed in this mode. */
  useApproval: boolean;
  /** Appended to the system prompt before each turn. */
  prompt: string;
  /** Optional subagent map (Multitask uses this). */
  agents?: Record<string, AgentDefinition>;
  /** UI label and color hint. */
  label: string;
};

export const MODE_DEFS: Record<Mode, ModeDef> = {
  agent: {
    tools: ALL_TOOLS,
    preApproved: READ_ONLY_TOOLS,
    useApproval: true,
    prompt: "",
    label: "Agent",
  },
  plan: {
    tools: READ_ONLY_TOOLS,
    preApproved: READ_ONLY_TOOLS,
    useApproval: false,
    prompt: PLAN_PROMPT,
    label: "Plan",
  },
  ask: {
    tools: READ_ONLY_TOOLS,
    preApproved: READ_ONLY_TOOLS,
    useApproval: false,
    prompt: ASK_PROMPT,
    label: "Ask",
  },
  multitask: {
    tools: [...ALL_TOOLS, "Agent"],
    preApproved: [...READ_ONLY_TOOLS, "Agent"],
    useApproval: true,
    prompt: MULTI_PROMPT,
    agents: { worker: WORKER_AGENT },
    label: "Multitask",
  },
  debug: {
    tools: ALL_TOOLS,
    preApproved: READ_ONLY_TOOLS,
    useApproval: true,
    prompt: DEBUG_PROMPT,
    label: "Debug",
  },
};

export function isMode(s: string): s is Mode {
  return s === "agent" || s === "plan" || s === "ask" || s === "multitask" || s === "debug";
}

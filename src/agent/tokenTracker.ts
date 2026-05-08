/**
 * Tracks per-session input / output token totals (including cache tokens) by
 * inspecting `usage` payloads on assistant and result messages from the SDK.
 * The numbers we care about for the % indicator are:
 *   inputTokens   = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *   outputTokens  = output_tokens
 * The "context window" cap is mode/model-dependent; we keep a small map and
 * default to 200k (Sonnet 4.6 / Opus 4.7).
 */

export type TokenSnapshot = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  contextLimit: number;
  /** Last-turn delta (useful for rendering "+1.2k this turn"). */
  lastTurnInput: number;
  lastTurnOutput: number;
};

const CONTEXT_LIMIT_BY_MODEL: Record<string, number> = {
  "claude-sonnet-4-6": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-opus-4-7": 200_000,
  "claude-opus-4-5": 200_000,
  "claude-haiku-4-5": 200_000,
};

export function contextLimitFor(model: string): number {
  return CONTEXT_LIMIT_BY_MODEL[model] ?? 200_000;
}

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export class TokenTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheCreateTokens = 0;
  private lastTurnInput = 0;
  private lastTurnOutput = 0;
  private model = "claude-sonnet-4-6";

  setModel(m: string): void {
    this.model = m;
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheCreateTokens = 0;
    this.lastTurnInput = 0;
    this.lastTurnOutput = 0;
  }

  /**
   * Folds a `usage` payload from an assistant or result message. We prefer the
   * result message's usage (it's authoritative for the turn) but fall back to
   * assistant streaming usage when the SDK exposes it.
   */
  ingestUsage(usage: RawUsage | undefined | null): void {
    if (!usage) return;
    const inT = usage.input_tokens ?? 0;
    const outT = usage.output_tokens ?? 0;
    const cR = usage.cache_read_input_tokens ?? 0;
    const cC = usage.cache_creation_input_tokens ?? 0;

    this.lastTurnInput = inT + cR + cC;
    this.lastTurnOutput = outT;

    this.inputTokens = Math.max(this.inputTokens, inT);
    this.cacheReadTokens = Math.max(this.cacheReadTokens, cR);
    this.cacheCreateTokens = Math.max(this.cacheCreateTokens, cC);
    this.outputTokens += outT;
  }

  /** For result messages where `usage` is the authoritative cumulative count. */
  ingestResultUsage(usage: RawUsage | undefined | null): void {
    if (!usage) return;
    const inT = usage.input_tokens ?? 0;
    const outT = usage.output_tokens ?? 0;
    const cR = usage.cache_read_input_tokens ?? 0;
    const cC = usage.cache_creation_input_tokens ?? 0;

    this.lastTurnInput = inT + cR + cC;
    this.lastTurnOutput = outT;

    this.inputTokens = inT;
    this.cacheReadTokens = cR;
    this.cacheCreateTokens = cC;
    this.outputTokens += outT;
  }

  snapshot(): TokenSnapshot {
    return {
      inputTokens: this.inputTokens + this.cacheReadTokens + this.cacheCreateTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheCreateTokens: this.cacheCreateTokens,
      contextLimit: contextLimitFor(this.model),
      lastTurnInput: this.lastTurnInput,
      lastTurnOutput: this.lastTurnOutput,
    };
  }
}

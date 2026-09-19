/**
 * Parse a client's reasoning intent from a chat completion request body.
 *
 * Reads every dialect we've seen in the wild: vLLM's top-level `thinking_token_budget`
 * (the ONE param that actually enforces a budget — see docs/guide/debugging-thinking.md),
 * `chat_template_kwargs.{enable_thinking,thinking_budget}`, OpenAI's `reasoning_effort`,
 * OpenRouter's `reasoning: {enabled,effort,max_tokens}`, and Anthropic's
 * `thinking: {type,budget_tokens}`. Haai has no schema for this route — this function
 * only *reads* fields, it never rejects or strips unrecognised ones.
 */

export type ReasoningMode = "enabled" | "disabled" | "unspecified";

export interface ReasoningIntent {
  mode: ReasoningMode;
  budgetTokens: number | null;
  effort: string | null;
  maxTokens: number | null;
  /** Which request fields contributed to this intent, for debugging. */
  sources: string[];
  /**
   * The only routing gate. Measured against both backends: toggling reasoning on/off
   * works fine everywhere, and `reasoning_effort` is unreliable on both — neither should
   * ever steer a request to a different backend. Only a positive token budget does.
   */
  needsBudgetEnforcement: boolean;
}

// Deliberately not applied by default — mapping effort to a concrete budget is Haai
// inventing semantics. Used only when the caller explicitly opts in (see dialect.ts).
const EFFORT_BUDGETS: Record<string, number> = {
  minimal: 512,
  low: 1024,
  medium: 4096,
  high: 16384,
  xhigh: 32768,
  max: 65536,
};

export function effortToBudget(effort: string): number | null {
  return EFFORT_BUDGETS[effort] ?? null;
}

export function parseReasoningIntent(body: Record<string, unknown>): ReasoningIntent {
  const sources: string[] = [];
  let mode: ReasoningMode = "unspecified";
  let budgetTokens: number | null = null;
  let effort: string | null = null;

  const maxTokens = typeof body["max_tokens"] === "number" ? (body["max_tokens"] as number) : null;

  if (typeof body["thinking_token_budget"] === "number") {
    budgetTokens = body["thinking_token_budget"] as number;
    sources.push("thinking_token_budget");
  }

  const ctk = body["chat_template_kwargs"];
  if (ctk && typeof ctk === "object") {
    const kw = ctk as Record<string, unknown>;
    if (typeof kw["enable_thinking"] === "boolean") {
      mode = kw["enable_thinking"] ? "enabled" : "disabled";
      sources.push("chat_template_kwargs.enable_thinking");
    }
    // Rescue the commonly-sent wrong-name variant — neither measured engine honours
    // this key, but it unambiguously signals budget intent.
    if (budgetTokens === null && typeof kw["thinking_budget"] === "number") {
      budgetTokens = kw["thinking_budget"] as number;
      sources.push("chat_template_kwargs.thinking_budget");
    }
  }

  if (typeof body["reasoning_effort"] === "string") {
    effort = body["reasoning_effort"] as string;
    sources.push("reasoning_effort");
    if (mode === "unspecified") mode = effort === "none" ? "disabled" : "enabled";
  }

  const reasoningObj = body["reasoning"];
  if (reasoningObj && typeof reasoningObj === "object") {
    const r = reasoningObj as Record<string, unknown>;
    if (typeof r["enabled"] === "boolean") {
      mode = r["enabled"] ? "enabled" : "disabled";
      sources.push("reasoning.enabled");
    }
    if (effort === null && typeof r["effort"] === "string") {
      effort = r["effort"] as string;
      sources.push("reasoning.effort");
    }
    if (budgetTokens === null && typeof r["max_tokens"] === "number") {
      budgetTokens = r["max_tokens"] as number;
      sources.push("reasoning.max_tokens");
    }
  }

  const thinkingObj = body["thinking"];
  if (thinkingObj && typeof thinkingObj === "object") {
    const t = thinkingObj as Record<string, unknown>;
    if (t["type"] === "enabled") {
      mode = "enabled";
      sources.push("thinking.type");
    } else if (t["type"] === "disabled") {
      mode = "disabled";
      sources.push("thinking.type");
    }
    if (budgetTokens === null && typeof t["budget_tokens"] === "number") {
      budgetTokens = t["budget_tokens"] as number;
      sources.push("thinking.budget_tokens");
    }
  }

  if (mode === "unspecified" && budgetTokens !== null) mode = "enabled";

  // An explicit disable beats any budget — no budget applies when thinking is off.
  if (mode === "disabled") budgetTokens = null;

  return {
    mode,
    budgetTokens,
    effort,
    maxTokens,
    sources,
    needsBudgetEnforcement: budgetTokens !== null && budgetTokens > 0,
  };
}

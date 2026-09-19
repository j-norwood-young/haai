// ── Reasoning capability model ───────────────────────────────────────────────
//
// Measured live against two real backends (vLLM 0.28 w/ a qwen3 reasoning parser,
// and oMLX — github.com/jundot/omlx). See docs/guide/debugging-thinking.md for the
// full matrix. A single boolean is not enough: both backends can TOGGLE reasoning
// and both SEPARATE it into its own response field, but only vLLM ENFORCES a
// token budget for it — oMLX accepts `thinking_token_budget` and silently ignores
// it. That distinction (`accepted_not_enforced`) is the one genuine routing-worthy
// capability gap; everything else is a naming disagreement, fixed by normalisation.

/** How a backend lets a client turn reasoning on/off. */
export type ReasoningToggleDialect = "none" | "chat_template_kwargs" | "reasoning_effort";

/** The field name a backend returns reasoning text under. */
export type ReasoningChannel = "none" | "reasoning" | "reasoning_content";

/**
 * "exact": the backend enforces the requested token budget (verified: vLLM, 50->49, 200->199).
 * "accepted_not_enforced": the backend accepts the parameter but ignores it — worse than
 *   rejecting it, because the client gets 200 while the constraint is silently violated
 *   (verified: oMLX, 50->1689 chars, 400->2034 chars).
 * "none": the backend has no known budget parameter at all.
 */
export type BudgetEnforcement = "exact" | "accepted_not_enforced" | "none";

export interface ReasoningCaps {
  toggle: ReasoningToggleDialect;
  budget: { enforcement: BudgetEnforcement; param: string | null };
  channel: ReasoningChannel;
  /** usage.completion_tokens_details.reasoning_tokens is present */
  usageReasoningTokens: boolean;
  /** stream_options.include_usage yields a final usage chunk */
  streamUsage: boolean;
}

export interface ResolvedReasoningCaps extends ReasoningCaps {
  /** provenance, surfaced on /v1/models for debugging */
  source: "provider-default" | "override";
  /** the profile these caps started from, before any override was merged in */
  profile: string;
}

export type ReasoningWarningCode =
  | "reasoning_budget_not_enforced"
  | "reasoning_budget_unsupported"
  | "reasoning_toggle_unsupported"
  | "reasoning_tokens_unreported"
  | "reasoning_no_capable_backend"
  | "reasoning_budget_exceeds_max_tokens"
  | "reasoning_max_tokens_too_small"
  | "reasoning_truncated"
  | "reasoning_effort_unreliable";

export interface ReasoningWarning {
  code: ReasoningWarningCode;
  severity: "warning" | "info";
  message: string;
  backend?: string;
  param?: string;
  [key: string]: unknown;
}

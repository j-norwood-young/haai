import type { ResolvedReasoningCaps, ReasoningWarning } from "@haai/core";
import type { ReasoningIntent } from "./intent.js";
import { effortToBudget } from "./intent.js";

export interface ReasoningPatchResult {
  /** Fields to shallow-merge into the outbound body. Additive only — never deletes
   * or overwrites a field the client sent (see chat_template_kwargs handling below). */
  patch: Record<string, unknown>;
  warnings: ReasoningWarning[];
}

/**
 * Translate a client's canonical reasoning intent into this backend's native dialect.
 *
 * Additive-only: every field the client sent still reaches the upstream verbatim (the
 * caller shallow-merges `patch` on top of the client's body); this function only adds
 * backend-native fields, and only for an intent the native field can express. It never
 * clobbers a client-supplied `chat_template_kwargs` key.
 */
export function applyReasoningDialect(
  body: Record<string, unknown>,
  intent: ReasoningIntent,
  caps: ResolvedReasoningCaps,
  backendName: string,
): ReasoningPatchResult {
  const patch: Record<string, unknown> = {};
  const warnings: ReasoningWarning[] = [];

  if (intent.mode === "unspecified") {
    return { patch, warnings };
  }

  const existingKwargs = (body["chat_template_kwargs"] as Record<string, unknown> | undefined) ?? {};
  const hasExplicitToggle = typeof existingKwargs["enable_thinking"] === "boolean";

  // ── Toggle ──
  if (caps.toggle === "chat_template_kwargs") {
    if (!hasExplicitToggle) {
      patch["chat_template_kwargs"] = { enable_thinking: intent.mode === "enabled", ...existingKwargs };
    }
  } else if (caps.toggle === "none" && intent.mode === "disabled") {
    warnings.push({
      code: "reasoning_toggle_unsupported",
      severity: "warning",
      message: `Backend '${backendName}' has no known way to disable reasoning; the request was forwarded as-is.`,
      backend: backendName,
    });
  }

  // ── Budget (the only routing-worthy axis) ──
  const hasExplicitBudget = typeof body["thinking_token_budget"] === "number";
  if (intent.mode === "enabled" && intent.needsBudgetEnforcement) {
    if (caps.budget.enforcement === "exact") {
      if (!hasExplicitBudget && caps.budget.param) {
        patch[caps.budget.param] = intent.budgetTokens;
      }
    } else if (caps.budget.enforcement === "accepted_not_enforced") {
      warnings.push({
        code: "reasoning_budget_not_enforced",
        severity: "warning",
        message: `Requested a reasoning budget of ${intent.budgetTokens} tokens, but backend '${backendName}' accepts this parameter without enforcing it — the response was generated with an unbounded reasoning budget.`,
        backend: backendName,
        ...(caps.budget.param ? { param: caps.budget.param } : {}),
        requested_budget: intent.budgetTokens,
      });
      // Do NOT add the param ourselves when the client didn't send it: doing so would
      // put a compliance-looking field in the request log while the constraint is
      // silently violated. If the client sent it, it already passes through untouched.
    } else {
      warnings.push({
        code: "reasoning_budget_unsupported",
        severity: "warning",
        message: `Requested a reasoning budget of ${intent.budgetTokens} tokens, but backend '${backendName}' has no known way to enforce one.`,
        backend: backendName,
        requested_budget: intent.budgetTokens,
      });
    }
  } else if (intent.mode === "enabled" && intent.effort && !intent.needsBudgetEnforcement) {
    warnings.push({
      code: "reasoning_effort_unreliable",
      severity: "info",
      message:
        "reasoning_effort is not a reliable control on this proxy's measured backends (non-monotonic on vLLM, ignored by oMLX); consider thinking_token_budget instead.",
      backend: backendName,
    });
    if (caps.budget.enforcement === "exact" && caps.budget.param && !hasExplicitBudget) {
      const mapped = effortToBudget(intent.effort);
      if (mapped) patch[caps.budget.param] = mapped;
    }
  }

  // ── Accounting gap ──
  if (intent.mode === "enabled" && !caps.usageReasoningTokens) {
    warnings.push({
      code: "reasoning_tokens_unreported",
      severity: "info",
      message: `Backend '${backendName}' does not report usage.completion_tokens_details.reasoning_tokens.`,
      backend: backendName,
    });
  }

  // ── The truncation trap — the exact thing that produced a wrong measurement while
  // building this feature. A reasoning request with too little max_tokens yields
  // partial chain-of-thought in `content` and finish_reason:"length" on every engine
  // we've tested. Flag it before the request even goes out. ──
  if (intent.mode === "enabled" && intent.maxTokens !== null) {
    if (intent.budgetTokens !== null && intent.maxTokens <= intent.budgetTokens * 1.2) {
      warnings.push({
        code: "reasoning_budget_exceeds_max_tokens",
        severity: "warning",
        message: `thinking_token_budget (${intent.budgetTokens}) leaves little or no room under max_tokens (${intent.maxTokens}) for a visible answer; consider raising max_tokens to at least ${intent.budgetTokens + 512}.`,
        backend: backendName,
      });
    } else if (intent.maxTokens < 512) {
      warnings.push({
        code: "reasoning_max_tokens_too_small",
        severity: "warning",
        message: `max_tokens (${intent.maxTokens}) is small for a reasoning request; the model may exhaust its budget mid-thought and return a truncated answer.`,
        backend: backendName,
      });
    }
  }

  return { patch, warnings };
}

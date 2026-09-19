import type { ReasoningCaps } from "./types.js";

/**
 * Default reasoning capabilities per provider. `vllm` and `omlx` are measured live
 * (see docs/guide/debugging-thinking.md and docs/guide/providers/omlx.md).
 * `lmstudio`, `ollama`, `openai`, and `generic` are conservative, UNVERIFIED
 * defaults — they claim no budget enforcement and no separate reasoning channel
 * until someone measures the real behaviour and either updates this table or sets
 * a per-backend override via `backends.reasoningCaps`. Do not guess upward.
 */
export const REASONING_PROFILES: Record<string, ReasoningCaps> = {
  vllm: {
    toggle: "chat_template_kwargs",
    budget: { enforcement: "exact", param: "thinking_token_budget" },
    channel: "reasoning",
    usageReasoningTokens: true,
    streamUsage: true,
  },
  omlx: {
    toggle: "chat_template_kwargs",
    budget: { enforcement: "accepted_not_enforced", param: "thinking_token_budget" },
    channel: "reasoning_content",
    usageReasoningTokens: false,
    streamUsage: true,
  },
  // Unverified below — measured facts stop here.
  openai: {
    toggle: "reasoning_effort",
    budget: { enforcement: "none", param: null },
    channel: "none",
    usageReasoningTokens: true,
    streamUsage: true,
  },
  lmstudio: {
    toggle: "none",
    budget: { enforcement: "none", param: null },
    channel: "none",
    usageReasoningTokens: false,
    streamUsage: true,
  },
  ollama: {
    toggle: "none",
    budget: { enforcement: "none", param: null },
    channel: "none",
    usageReasoningTokens: false,
    streamUsage: true,
  },
  generic: {
    toggle: "none",
    budget: { enforcement: "none", param: null },
    channel: "none",
    usageReasoningTokens: false,
    streamUsage: false,
  },
};

export const DEFAULT_REASONING_PROFILE = "generic";

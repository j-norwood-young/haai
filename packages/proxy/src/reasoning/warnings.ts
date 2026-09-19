import type { ReasoningWarning } from "@haai/core";

/** Comma-joined warning codes — used for the X-HAAI-Warning header. Header values must
 * be latin-1 and newline-free, so codes only; full prose lives in the body/stream chunk. */
export function warningCodesHeader(warnings: ReasoningWarning[]): string {
  return warnings.map((w) => w.code).join(",");
}

/** Build the SSE line for a synthetic trailing chunk carrying warnings, shaped like the
 * `choices: []` final usage chunk both measured backends already send (so well-behaved
 * clients already tolerate an empty-choices chunk). Emitted only when warnings exist. */
export function buildWarningChunkLine(warnings: ReasoningWarning[], modelId: string): string {
  const chunk = {
    id: `haai-warning-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [],
    haai: { warnings },
  };
  return `data: ${JSON.stringify(chunk)}`;
}

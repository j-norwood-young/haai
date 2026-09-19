/**
 * Additive, bidirectional field-name aliasing between vLLM's `reasoning` and oMLX's
 * `reasoning_content`. Both backends separate reasoning into its own field — they just
 * disagree on the name — so this makes either name readable regardless of which backend
 * actually served the request.
 *
 * Rules, load-bearing:
 *   - Never overwrite a value that's already present under the other name.
 *   - Never fabricate a field when NEITHER name is present. Absence means "this backend
 *     told us nothing", which is a different claim from "reasoning was empty".
 *   - Idempotent: safe to call more than once on the same object (e.g. once before and
 *     once after a plugin's onResponse hook).
 */

const REASONING_FIELD_NAMES = ["reasoning", "reasoning_content"] as const;

function aliasReasoningKeys(obj: Record<string, unknown>): boolean {
  const present = REASONING_FIELD_NAMES.filter((k) => typeof obj[k] === "string");
  if (present.length === 0 || present.length === REASONING_FIELD_NAMES.length) return false;
  const value = obj[present[0]!];
  let changed = false;
  for (const key of REASONING_FIELD_NAMES) {
    if (obj[key] === undefined) {
      obj[key] = value;
      changed = true;
    }
  }
  return changed;
}

export function aliasReasoningInMessage(message: Record<string, unknown> | null | undefined): boolean {
  if (!message || typeof message !== "object") return false;
  return aliasReasoningKeys(message);
}

/** Non-streaming response: alias reasoning in every choice's message. */
export function aliasReasoningInResponse(response: Record<string, unknown>): boolean {
  const choices = response["choices"] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(choices)) return false;
  let changed = false;
  for (const choice of choices) {
    const message = choice["message"] as Record<string, unknown> | undefined;
    if (message && aliasReasoningInMessage(message)) changed = true;
  }
  return changed;
}

/** Streaming chunk: alias reasoning in every choice's delta. */
export function aliasReasoningInChunk(chunk: Record<string, unknown>): boolean {
  const choices = chunk["choices"] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(choices)) return false;
  let changed = false;
  for (const choice of choices) {
    const delta = choice["delta"] as Record<string, unknown> | undefined;
    if (delta && aliasReasoningKeys(delta)) changed = true;
  }
  return changed;
}

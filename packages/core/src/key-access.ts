/** Parse a JSON-encoded allow-list column; null means unrestricted. */
export function parseAllowedList(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return null;
  }
}

/** Whether a key can see or use any models (v-models and/or pass-through backends). */
export function hasModelSourceAccess(
  allowedModels: string[] | null | undefined,
  allowedBackends: string[] | null | undefined,
): boolean {
  const vModelAccess = allowedModels == null || allowedModels.length > 0;
  const backendAccess = allowedBackends == null || allowedBackends.length > 0;
  return vModelAccess || backendAccess;
}

export function validateKeyModelAccess(
  allowedModels: string[] | null | undefined,
  allowedBackends: string[] | null | undefined,
): string | null {
  if (!hasModelSourceAccess(allowedModels, allowedBackends)) {
    return "Select at least one allowed v-model or pass-through backend, or allow all in each section.";
  }
  return null;
}

/**
 * Whether a key may use a v-model. `allowedModels` may contain the public alias
 * (`smart-chat`) and/or the internal row id (`vmodel-…`); both must match.
 */
export function isVModelAllowed(
  allowedModels: string[] | null,
  modelId: string,
  internalId?: string,
): boolean {
  if (allowedModels === null) return true;
  if (allowedModels.includes(modelId)) return true;
  if (internalId != null && allowedModels.includes(internalId)) return true;
  return false;
}

export function isBackendAllowed(allowedBackends: string[] | null, backendId: string): boolean {
  if (allowedBackends === null) return true;
  return allowedBackends.includes(backendId);
}

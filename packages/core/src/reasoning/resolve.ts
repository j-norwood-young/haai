import { REASONING_PROFILES, DEFAULT_REASONING_PROFILE } from "./profiles.js";
import type { ReasoningCaps, ResolvedReasoningCaps } from "./types.js";

/**
 * Resolve a backend's effective reasoning capabilities.
 *
 * Resolution order: `backend.reasoningCaps` JSON override -> provider default -> "generic".
 * The override is a *partial* merge over its starting profile (or the provider default if
 * it doesn't name one), so an admin can flip a single field (e.g. mark a hand-patched vLLM
 * build as `{"budget":{"enforcement":"exact"}}`) without restating the whole shape.
 *
 * Deliberately not derived from `provider` alone: `provider` is part of the published
 * model-id composite key (`<model>:<hostName>:<provider>`) and PATCH refuses to change it,
 * so a backend that was registered under the wrong provider (or whose real capabilities
 * diverge from the provider default) would otherwise be permanently mis-capability'd.
 */
export function resolveReasoningCaps(backend: {
  provider: string;
  reasoningCaps: string | null;
}): ResolvedReasoningCaps {
  const baseProfileName = REASONING_PROFILES[backend.provider] ? backend.provider : DEFAULT_REASONING_PROFILE;
  const baseProfile = REASONING_PROFILES[baseProfileName] ?? REASONING_PROFILES[DEFAULT_REASONING_PROFILE]!;

  if (!backend.reasoningCaps) {
    return { ...baseProfile, source: "provider-default", profile: baseProfileName };
  }

  try {
    const override = JSON.parse(backend.reasoningCaps) as Partial<ReasoningCaps> & { profile?: string };
    const startProfileName =
      override.profile && REASONING_PROFILES[override.profile] ? override.profile : baseProfileName;
    const start = REASONING_PROFILES[startProfileName] ?? baseProfile;

    const merged: ReasoningCaps = {
      ...start,
      ...override,
      budget: { ...start.budget, ...(override.budget ?? {}) },
    };
    return { ...merged, source: "override", profile: startProfileName };
  } catch {
    return { ...baseProfile, source: "provider-default", profile: baseProfileName };
  }
}

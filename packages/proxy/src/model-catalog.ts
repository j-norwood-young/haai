import { lookupModelKind, parseModelCatalogJson, type ModelKind } from "@haai/core";

export interface KindLookup {
  kind: ModelKind;
  positive: boolean;
}

/**
 * Parses a backend row's cached model catalog once and returns a resolver
 * function for looking up individual model kinds. Every request-path
 * consumer of model kinds should go through this — the catalog is only
 * ever populated by the health poll (see health.ts / model-probe.ts), never
 * refreshed on the request path.
 */
export function backendKindResolver(row: {
  modelCatalog: string | null | undefined;
}): (rawModelId: string) => KindLookup {
  const entries = parseModelCatalogJson(row.modelCatalog);
  return (rawModelId: string) => lookupModelKind(entries, rawModelId);
}

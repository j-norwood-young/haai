import { eq } from "drizzle-orm";
import type { DbClient } from "@haai/core";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  vmodelBackends as vmodelBackendsTable,
  modelKindRoutingClass,
  parseVModelKind,
  type MappingUnavailableReason,
  type ModelKind,
  type VModelHealthStatus,
  type VModelKind,
} from "@haai/core";
import type { SseEmitter } from "./sse.js";
import { backendKindResolver } from "./model-catalog.js";

export interface MappingAvailability {
  available: boolean;
  reason: MappingUnavailableReason | null;
}

export function parseAvailableModelsJson(raw: string | null | undefined): string[] | null {
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

export function evaluateMappingAvailability(opts: {
  backendEnabled: boolean;
  backendHealth: string | null;
  backendModelId: string;
  availableModels: string[] | null;
  /** The v-model's routing class; defaults to "chat" (matches the DB column default). */
  vmodelKind?: VModelKind | undefined;
  /** The mapped backend model's resolved kind; a mismatch only blocks when `positive`. */
  modelKind?: { kind: ModelKind; positive: boolean } | null | undefined;
}): MappingAvailability {
  if (!opts.backendEnabled) {
    return { available: false, reason: "backend_disabled" };
  }
  if (opts.backendHealth === "unhealthy") {
    return { available: false, reason: "backend_unhealthy" };
  }
  if (opts.availableModels == null) {
    return { available: false, reason: "inventory_unknown" };
  }
  if (!opts.availableModels.includes(opts.backendModelId)) {
    return { available: false, reason: "model_missing" };
  }
  const vmodelKind = opts.vmodelKind ?? "chat";
  if (opts.modelKind?.positive && modelKindRoutingClass(opts.modelKind.kind) !== vmodelKind) {
    return { available: false, reason: "model_kind_mismatch" };
  }
  return { available: true, reason: null };
}

function reasonLabel(reason: MappingUnavailableReason | null, backendModelId: string): string {
  switch (reason) {
    case "backend_disabled":
      return "backend disabled";
    case "backend_unhealthy":
      return "backend unhealthy";
    case "model_missing":
      return `model '${backendModelId}' not available`;
    case "inventory_unknown":
      return "model inventory unknown";
    case "model_kind_mismatch":
      return `model '${backendModelId}' is not a compatible kind for this v-model`;
    default:
      return "unavailable";
  }
}

export function deriveVModelHealth(opts: {
  mappingCount: number;
  availableCount: number;
  reasons: string[];
}): { status: VModelHealthStatus; error: string | null } {
  if (opts.mappingCount === 0) {
    return { status: "unhealthy", error: "No backends configured" };
  }
  if (opts.availableCount === opts.mappingCount) {
    return { status: "healthy", error: null };
  }
  if (opts.availableCount === 0) {
    const detail = opts.reasons.length > 0 ? opts.reasons.slice(0, 3).join("; ") : "all mappings unavailable";
    return { status: "unhealthy", error: detail };
  }
  return {
    status: "degraded",
    error: `${opts.availableCount}/${opts.mappingCount} mappings available`,
  };
}

/** Recompute availability for all v-model mappings and persist derived v-model health. */
export async function recomputeAllVModelHealth(
  db: DbClient,
  sse?: SseEmitter,
): Promise<void> {
  const now = Date.now();
  const backends = await db.db.select().from(backendsTable).all();
  const backendById = new Map(backends.map((b) => [b.id, b]));

  const vmodels = await db.db.select().from(vmodelsTable).all();
  const changed: Array<{
    vmodelId: string;
    modelId: string;
    status: VModelHealthStatus;
    error: string | null;
  }> = [];

  for (const vm of vmodels) {
    if (!vm.enabled) {
      await db.db
        .update(vmodelsTable)
        .set({
          lastHealthStatus: "unknown",
          lastHealthError: "V-model disabled",
          lastHealthCheck: now,
          updatedAt: now,
        })
        .where(eq(vmodelsTable.id, vm.id))
        .run();
      continue;
    }

    const mappings = await db.db
      .select()
      .from(vmodelBackendsTable)
      .where(eq(vmodelBackendsTable.vmodelId, vm.id))
      .all();

    const enabledMappings = mappings.filter((m) => m.enabled);
    let availableCount = 0;
    const reasons: string[] = [];

    const vmodelKind = parseVModelKind(vm.kind) ?? "chat";

    for (const mapping of mappings) {
      const backend = backendById.get(mapping.backendId);
      const availability = !mapping.enabled
        ? ({ available: false, reason: "backend_disabled" as const })
        : evaluateMappingAvailability({
            backendEnabled: backend?.enabled ?? false,
            backendHealth: backend?.lastHealthStatus ?? null,
            backendModelId: mapping.backendModelId,
            availableModels: parseAvailableModelsJson(backend?.availableModels ?? null),
            vmodelKind,
            modelKind: backend
              ? backendKindResolver(backend)(mapping.backendModelId)
              : null,
          });

      if (mapping.enabled && availability.available) availableCount += 1;
      if (mapping.enabled && !availability.available && availability.reason) {
        const backendName = backend?.displayName || backend?.name || mapping.backendId;
        reasons.push(`${backendName}: ${reasonLabel(availability.reason, mapping.backendModelId)}`);
      }

      await db.db
        .update(vmodelBackendsTable)
        .set({
          lastAvailable: mapping.enabled ? availability.available : false,
          unavailableReason: mapping.enabled
            ? (availability.reason ?? null)
            : "backend_disabled",
        })
        .where(eq(vmodelBackendsTable.id, mapping.id))
        .run();
    }

    const derived = deriveVModelHealth({
      mappingCount: enabledMappings.length,
      availableCount,
      reasons,
    });

    const prevStatus = vm.lastHealthStatus;
    const prevError = vm.lastHealthError;
    await db.db
      .update(vmodelsTable)
      .set({
        lastHealthStatus: derived.status,
        lastHealthError: derived.error,
        lastHealthCheck: now,
        updatedAt: now,
      })
      .where(eq(vmodelsTable.id, vm.id))
      .run();

    if (prevStatus !== derived.status || prevError !== derived.error) {
      changed.push({
        vmodelId: vm.id,
        modelId: vm.modelId,
        status: derived.status,
        error: derived.error,
      });
    }
  }

  if (sse) {
    if (changed.length > 0) {
      for (const item of changed) {
        const payload: {
          vmodelId: string;
          modelId: string;
          status: VModelHealthStatus;
          error?: string;
        } = {
          vmodelId: item.vmodelId,
          modelId: item.modelId,
          status: item.status,
        };
        if (item.error) payload.error = item.error;
        sse.broadcast("vmodel-health", payload);
      }
    } else {
      sse.broadcast("vmodel-health", { action: "poll" });
    }
  }
}

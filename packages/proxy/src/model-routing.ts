import { and, eq, inArray } from "drizzle-orm";
import {
  backends as backendsTable,
  vmodels as vmodelsTable,
  vmodelBackends as vmodelBackendsTable,
  resolveReasoningCaps,
  parseVModelKind,
  modelKindRoutingClass,
  decrypt,
  type Backend,
  type VModelKind,
} from "@haai/core";
import type { AppContext } from "./context.js";
import type { BackendCandidate } from "./balancer.js";
import { backendKindResolver } from "./model-catalog.js";

/** Which inference endpoint a request is being routed for. */
export type RouteKind = "chat" | "embedding";

const ROUTE_KIND_ENDPOINT: Record<RouteKind, string> = {
  chat: "/v1/chat/completions",
  embedding: "/v1/embeddings",
};

export interface ResolvedRoute {
  ok: true;
  /** The matched v-model row, or null when the request resolved via a pass-through namespaced id. */
  vmodel: typeof vmodelsTable.$inferSelect | null;
  candidates: BackendCandidate[];
}

export interface UnresolvedRoute {
  ok: false;
  status: 400 | 404;
  message: string;
  code?: string;
}

export type ResolveResult = ResolvedRoute | UnresolvedRoute;

function mapBackendRow(row: typeof backendsTable.$inferSelect): Backend {
  return row as unknown as Backend;
}

function kindMismatchMessage(requestedModel: string, actual: RouteKind, requested: RouteKind): string {
  return (
    `Model '${requestedModel}' is ${actual === "embedding" ? "an embedding" : "a chat"} model ` +
    `and is not supported on ${ROUTE_KIND_ENDPOINT[requested]}. ` +
    `Use POST ${ROUTE_KIND_ENDPOINT[actual]}.`
  );
}

/**
 * Resolves a requested model id (a v-model alias or a pass-through
 * "model:hostName:provider" id) to a set of backend candidates, for the
 * given route kind (chat vs embedding). Shared by /v1/chat/completions and
 * /v1/embeddings so both endpoints enforce the same kind guards.
 *
 * Two layers of enforcement:
 *  - Guard A (immediate): the v-model's own `kind` column must match the
 *    requested route kind. This works the instant a v-model is created,
 *    with no dependency on the model catalog having been populated yet.
 *  - Guard B (defence in depth): each member's *positively* classified
 *    model kind (native probe, or a positive heuristic hit) is checked
 *    against the route kind. A member that only carries a heuristic
 *    "unknown" guess is never excluded by this guard — only a confirmed
 *    contradiction blocks it.
 */
export async function resolveModelRoute(
  ctx: AppContext,
  requestedModel: string,
  routeKind: RouteKind,
): Promise<ResolveResult> {
  const vmodel = await ctx.db.db
    .select()
    .from(vmodelsTable)
    .where(and(eq(vmodelsTable.modelId, requestedModel), eq(vmodelsTable.enabled, true)))
    .get();

  if (vmodel) {
    const vmodelKind: VModelKind = parseVModelKind(vmodel.kind) ?? "chat";
    if (vmodelKind !== routeKind) {
      return {
        ok: false,
        status: 400,
        message: kindMismatchMessage(requestedModel, vmodelKind, routeKind),
        code: "model_not_supported",
      };
    }

    const vmBackends = await ctx.db.db
      .select()
      .from(vmodelBackendsTable)
      .where(
        and(eq(vmodelBackendsTable.vmodelId, vmodel.id), eq(vmodelBackendsTable.enabled, true)),
      )
      .all();

    const backendIds = [...new Set(vmBackends.map((vmb) => vmb.backendId))];
    const backendRows =
      backendIds.length > 0
        ? await ctx.db.db
            .select()
            .from(backendsTable)
            .where(inArray(backendsTable.id, backendIds))
            .all()
        : [];
    const backendById = new Map(backendRows.map((b) => [b.id, b]));

    const candidates: BackendCandidate[] = [];
    for (const vmb of vmBackends) {
      const backend = backendById.get(vmb.backendId);
      if (!backend) continue;
      const mapped = mapBackendRow(backend);
      const modelKind = backendKindResolver(backend)(vmb.backendModelId);
      // Guard B: drop members that positively contradict the v-model's kind.
      // Never drop on a mere heuristic guess (positive: false).
      if (modelKind.positive && modelKindRoutingClass(modelKind.kind) !== vmodelKind) {
        continue;
      }
      candidates.push({
        backendId: backend.id,
        backend: mapped,
        backendModelId: vmb.backendModelId,
        weight: vmb.weight,
        reasoning: resolveReasoningCaps(mapped),
        vmodelKind,
        modelKind,
      });
    }

    if (candidates.length === 0 && vmBackends.length > 0) {
      return {
        ok: false,
        status: 400,
        message: `No available backends for model '${requestedModel}': all mapped backend models are ${
          routeKind === "chat" ? "embedding" : "chat"
        } models`,
        code: "model_not_supported",
      };
    }

    return { ok: true, vmodel, candidates };
  }

  // Pass-through namespaced lookup: "model:hostName:provider"
  const parts = requestedModel.split(":");
  if (parts.length < 3) {
    return {
      ok: false,
      status: 404,
      message: `Model '${requestedModel}' not found`,
    };
  }

  const modelId = parts.slice(0, -2).join(":");
  const hostName = parts[parts.length - 2];
  const provider = parts[parts.length - 1];

  const backend = await ctx.db.db
    .select()
    .from(backendsTable)
    .where(
      and(
        eq(backendsTable.hostName, hostName ?? ""),
        eq(backendsTable.provider, provider ?? ""),
        eq(backendsTable.enabled, true),
      ),
    )
    .get();

  if (!backend) {
    return {
      ok: false,
      status: 404,
      message: `Model '${requestedModel}' not found`,
    };
  }

  const modelKind = backendKindResolver(backend)(modelId);
  if (modelKind.positive && modelKindRoutingClass(modelKind.kind) !== routeKind) {
    return {
      ok: false,
      status: 400,
      message: kindMismatchMessage(requestedModel, modelKindRoutingClass(modelKind.kind), routeKind),
      code: "model_not_supported",
    };
  }

  const mapped = mapBackendRow(backend);
  return {
    ok: true,
    vmodel: null,
    candidates: [
      {
        backendId: backend.id,
        backend: mapped,
        backendModelId: modelId,
        weight: backend.weight,
        reasoning: resolveReasoningCaps(mapped),
        // Pass-through has no v-model row, but availability checks (isCandidateAvailable)
        // still need a routing class to compare the resolved model kind against —
        // otherwise it would silently default to "chat" and reject a valid embedding
        // pass-through request as a phantom kind mismatch.
        vmodelKind: routeKind,
        modelKind,
      },
    ],
  };
}

/** Resolves which API key to send upstream for a selected backend. */
export function upstreamApiKeyFor(
  backend: Pick<Backend, "keyMode" | "encryptedApiKey">,
  rawKey: string,
  masterKey: Buffer,
): string | null {
  if (backend.keyMode === "abstraction" && backend.encryptedApiKey) {
    return decrypt(backend.encryptedApiKey, masterKey);
  }
  if (backend.keyMode === "passthrough") {
    return rawKey;
  }
  return null;
}

export interface ProxyLikeResult {
  statusCode: number;
  error?: string | undefined;
}

export function isRetryableUpstreamFailure(result: ProxyLikeResult): boolean {
  if (result.statusCode === 404) return true;
  if (result.statusCode >= 500) return true;
  const err = (result.error ?? "").toLowerCase();
  if (err.includes("model") && (err.includes("not found") || err.includes("does not exist"))) {
    return true;
  }
  return false;
}

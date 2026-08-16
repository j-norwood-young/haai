import { createHash, timingSafeEqual } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { DbClient } from "@haai/core";
import { apiKeys, tokenBudgetCounters } from "@haai/core";
import type { ApiKey } from "@haai/core";
import {
  isBackendAllowed,
  isVModelAllowed,
  parseAllowedList,
} from "@haai/core";
import { rateLimitHitsTotal } from "./metrics.js";
import { getLogger } from "./logger.js";

export type AuthResult =
  | { success: false; status: 401 | 403 | 429; error: string; code: string }
  | { success: true; key: ApiKey };

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function timeSafeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function getBucketKey(period: string): string {
  const now = new Date();
  switch (period) {
    case "hour": {
      const d = new Date(now);
      d.setMinutes(0, 0, 0);
      return d.toISOString();
    }
    case "day": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case "week": {
      const d = new Date(now);
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case "month": {
      const d = new Date(now);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    default:
      return now.toISOString();
  }
}

export class KeyAuthenticator {
  constructor(private readonly db: DbClient) {}

  async authenticate(rawKey: string): Promise<AuthResult> {
    const log = getLogger();

    if (!rawKey.startsWith("haai-sk-")) {
      return { success: false, status: 401, error: "Invalid key format", code: "invalid_key" };
    }

    const keyHash = hashKey(rawKey);
    const prefix = rawKey.slice(0, 13);

    // Find candidate keys by prefix (avoids full table scan)
    const candidates = await this.db.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.prefix, prefix))
      .all();

    let matchedKey: ApiKey | null = null;
    for (const candidate of candidates) {
      if (timeSafeCompare(keyHash, candidate.keyHash)) {
        matchedKey = candidate as ApiKey;
        break;
      }
    }

    if (!matchedKey) {
      log.warn({ prefix }, "API key not found");
      return { success: false, status: 401, error: "Invalid API key", code: "invalid_key" };
    }

    if (!matchedKey.enabled || matchedKey.suspended) {
      const reason = matchedKey.suspended ? matchedKey.suspendedReason ?? "Key suspended" : "Key disabled";
      rateLimitHitsTotal.inc({ key_prefix: prefix, reason: "suspended" });
      return { success: false, status: 403, error: reason, code: "key_suspended" };
    }

    if (matchedKey.expiresAt && matchedKey.expiresAt < Date.now()) {
      return { success: false, status: 403, error: "API key expired", code: "key_expired" };
    }

    return { success: true, key: matchedKey };
  }

  async checkVModelAccess(
    key: ApiKey,
    vmodelId: string,
    capabilities: { tools?: boolean; vision?: boolean; embeddings?: boolean },
  ): Promise<{ allowed: true } | { allowed: false; error: string }> {
    if (!isVModelAllowed(parseAllowedList(key.allowedModels), vmodelId)) {
      return { allowed: false, error: `Virtual model ${vmodelId} not allowed for this key` };
    }
    return this.checkCapabilities(key, capabilities);
  }

  async checkBackendAccess(
    key: ApiKey,
    backendId: string,
    capabilities: { tools?: boolean; vision?: boolean; embeddings?: boolean },
  ): Promise<{ allowed: true } | { allowed: false; error: string }> {
    if (!isBackendAllowed(parseAllowedList(key.allowedBackends), backendId)) {
      return { allowed: false, error: "Pass-through backend not allowed for this key" };
    }
    return this.checkCapabilities(key, capabilities);
  }

  private checkCapabilities(
    key: ApiKey,
    capabilities: { tools?: boolean; vision?: boolean; embeddings?: boolean },
  ): { allowed: true } | { allowed: false; error: string } {
    if (capabilities.tools && !key.allowToolCalling) {
      return { allowed: false, error: "Tool calling not allowed for this key" };
    }
    if (capabilities.vision && !key.allowVision) {
      return { allowed: false, error: "Vision not allowed for this key" };
    }
    if (capabilities.embeddings && !key.allowEmbeddings) {
      return { allowed: false, error: "Embeddings not allowed for this key" };
    }

    return { allowed: true };
  }

  async checkTokenBudget(
    key: ApiKey,
    tokensToConsume: number = 0,
  ): Promise<{ allowed: true } | { allowed: false; error: string; period: string }> {
    const periods: Array<{ period: string; budget: number | null }> = [
      { period: "hour", budget: key.tokenBudgetHour },
      { period: "day", budget: key.tokenBudgetDay },
      { period: "week", budget: key.tokenBudgetWeek },
      { period: "month", budget: key.tokenBudgetMonth },
    ];

    for (const { period, budget } of periods) {
      if (budget === null) continue;

      const bucket = getBucketKey(period);
      const counter = await this.db.db
        .select()
        .from(tokenBudgetCounters)
        .where(
          and(
            eq(tokenBudgetCounters.keyId, key.id),
            eq(tokenBudgetCounters.period, period),
            eq(tokenBudgetCounters.bucket, bucket),
          ),
        )
        .get();

      const used = counter?.tokensUsed ?? 0;
      if (used + tokensToConsume > budget) {
        rateLimitHitsTotal.inc({ key_prefix: key.prefix, reason: `budget_${period}` });
        return {
          allowed: false,
          error: `Token budget exceeded for ${period} (used: ${used}, budget: ${budget})`,
          period,
        };
      }
    }

    return { allowed: true };
  }

  async consumeTokenBudget(keyId: string, tokens: number): Promise<void> {
    const periods = ["hour", "day", "week", "month"];
    const now = Date.now();

    for (const period of periods) {
      const bucket = getBucketKey(period);

      const existing = await this.db.db
        .select()
        .from(tokenBudgetCounters)
        .where(
          and(
            eq(tokenBudgetCounters.keyId, keyId),
            eq(tokenBudgetCounters.period, period),
            eq(tokenBudgetCounters.bucket, bucket),
          ),
        )
        .get();

      if (existing) {
        await this.db.db
          .update(tokenBudgetCounters)
          .set({
            tokensUsed: existing.tokensUsed + tokens,
            updatedAt: now,
          })
          .where(eq(tokenBudgetCounters.id, existing.id))
          .run();
      } else {
        await this.db.db
          .insert(tokenBudgetCounters)
          .values({
            id: `tbc-${keyId}-${period}-${bucket}`,
            keyId,
            period,
            bucket,
            tokensUsed: tokens,
            updatedAt: now,
          })
          .run();
      }
    }
  }

  async touchLastUsed(keyId: string): Promise<void> {
    await this.db.db
      .update(apiKeys)
      .set({ lastUsedAt: Date.now() })
      .where(eq(apiKeys.id, keyId))
      .run();
  }
}

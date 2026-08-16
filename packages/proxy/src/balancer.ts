import { createHash } from "node:crypto";
import type { Backend } from "@ai-v-models/core";
import type { BalancingStrategy } from "@ai-v-models/core";
import { CircuitBreaker } from "./circuit-breaker.js";
import { backendConcurrencyGauge } from "./metrics.js";
import {
  evaluateMappingAvailability,
  parseAvailableModelsJson,
} from "./vmodel-health.js";

export interface BackendCandidate {
  backendId: string;
  backend: Backend;
  backendModelId: string;
  weight: number;
}

export function isCandidateAvailable(candidate: BackendCandidate): boolean {
  return evaluateMappingAvailability({
    backendEnabled: candidate.backend.enabled,
    backendHealth: candidate.backend.lastHealthStatus,
    backendModelId: candidate.backendModelId,
    availableModels: parseAvailableModelsJson(candidate.backend.availableModels),
  }).available;
}

export function filterAvailableCandidates(candidates: BackendCandidate[]): BackendCandidate[] {
  return candidates.filter((c) => {
    if (!isCandidateAvailable(c)) return false;
    return true;
  });
}

export class BackendBalancer {
  private roundRobinCounters = new Map<string, number>();
  private concurrencyCounters = new Map<string, number>();
  private circuitBreakers = new Map<string, CircuitBreaker>();

  getCircuitBreaker(backendId: string, backendName: string): CircuitBreaker {
    let cb = this.circuitBreakers.get(backendId);
    if (!cb) {
      cb = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 60_000,
        backendName,
      });
      this.circuitBreakers.set(backendId, cb);
    }
    return cb;
  }

  incrementConcurrency(backendId: string): void {
    const current = this.concurrencyCounters.get(backendId) ?? 0;
    this.concurrencyCounters.set(backendId, current + 1);
    backendConcurrencyGauge.set({ backend: backendId }, current + 1);
  }

  decrementConcurrency(backendId: string): void {
    const current = this.concurrencyCounters.get(backendId) ?? 0;
    const next = Math.max(0, current - 1);
    this.concurrencyCounters.set(backendId, next);
    backendConcurrencyGauge.set({ backend: backendId }, next);
  }

  getConcurrency(backendId: string): number {
    return this.concurrencyCounters.get(backendId) ?? 0;
  }

  select(
    candidates: BackendCandidate[],
    strategy: BalancingStrategy,
    sessionKey?: string,
  ): BackendCandidate | null {
    // Exclude disabled, unhealthy, model-missing, and open-circuit backends.
    const available = candidates.filter((c) => {
      if (!isCandidateAvailable(c)) return false;
      const cb = this.circuitBreakers.get(c.backendId);
      if (cb?.isOpen) return false;
      return true;
    });

    if (available.length === 0) {
      // Soft fallback: available mappings whose circuit is open (half-open trial),
      // otherwise null — never fall back to unhealthy / missing-model hosts.
      const withOpenCircuit = candidates.filter((c) => {
        if (!isCandidateAvailable(c)) return false;
        return this.circuitBreakers.get(c.backendId)?.isOpen === true;
      });
      if (withOpenCircuit.length === 0) return null;
      return withOpenCircuit[0] ?? null;
    }

    switch (strategy) {
      case "session-pin":
        return this.selectSessionPin(available, sessionKey);
      case "round-robin":
        return this.selectRoundRobin(available, candidates[0]?.backendId ?? "default");
      case "weighted":
        return this.selectWeighted(available);
      case "least-connections":
        return this.selectLeastConnections(available);
      case "least-latency":
        return this.selectLeastLatency(available);
      default:
        return available[0] ?? null;
    }
  }

  private selectSessionPin(
    available: BackendCandidate[],
    sessionKey?: string,
  ): BackendCandidate | null {
    if (!sessionKey || available.length === 1) return available[0] ?? null;
    const hash = createHash("sha256").update(sessionKey).digest("hex");
    const idx = parseInt(hash.slice(0, 8), 16) % available.length;
    return available[idx] ?? null;
  }

  private selectRoundRobin(
    available: BackendCandidate[],
    counterKey: string,
  ): BackendCandidate | null {
    const counter = this.roundRobinCounters.get(counterKey) ?? 0;
    const idx = counter % available.length;
    this.roundRobinCounters.set(counterKey, counter + 1);
    return available[idx] ?? null;
  }

  private selectWeighted(available: BackendCandidate[]): BackendCandidate | null {
    const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const c of available) {
      rand -= c.weight;
      if (rand <= 0) return c;
    }
    return available[available.length - 1] ?? null;
  }

  private selectLeastConnections(available: BackendCandidate[]): BackendCandidate | null {
    return available.reduce((best, c) => {
      const bestConc = this.getConcurrency(best.backendId);
      const cConc = this.getConcurrency(c.backendId);
      return cConc < bestConc ? c : best;
    });
  }

  private selectLeastLatency(available: BackendCandidate[]): BackendCandidate | null {
    return available.reduce((best, c) => {
      const bestLatency = best.backend.lastLatencyMs ?? Infinity;
      const cLatency = c.backend.lastLatencyMs ?? Infinity;
      return cLatency < bestLatency ? c : best;
    });
  }
}

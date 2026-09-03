import { api, parseMetricsEvent } from '$lib/api.js';
import type {
	InFlightRequest,
	LivePoint,
	LiveProbeSample,
	LiveSnapshot,
	MetricsEvent
} from '$lib/api.js';
import { sse, type SseEvent } from '$lib/sse.svelte.js';

const MAX_SERIES = 600;
const MAX_INFLIGHT = 50;
const MAX_RECENT_EVENTS = 200;
const MAX_PROBES = 120;

export interface LiveBackendState {
	concurrency: number;
	circuit: 'closed' | 'open' | 'half-open';
	probes: LiveProbeSample[];
}

interface LiveState {
	snapshot: LiveSnapshot | null;
	series: LivePoint[];
	inFlight: InFlightRequest[];
	inFlightTotal: number;
	backends: Map<string, LiveBackendState>;
	recentEvents: MetricsEvent[];
	lastTickAt: number;
}

const state = $state<LiveState>({
	snapshot: null,
	series: [],
	inFlight: [],
	inFlightTotal: 0,
	backends: new Map(),
	recentEvents: [],
	lastTickAt: 0
});

let refCount = 0;
let unsubscribe: (() => void) | null = null;
let snapshotLoading = false;

function applySnapshot(snapshot: LiveSnapshot) {
	state.snapshot = snapshot;
	state.series = [...snapshot.series];
	state.inFlight = [...snapshot.inFlight];
	state.inFlightTotal = snapshot.inFlightTotal;
	state.backends = new Map(
		snapshot.backends.map((b) => [
			b.backendId,
			{ concurrency: b.concurrency, circuit: b.circuit, probes: [...b.probes] }
		])
	);
}

async function resync() {
	if (snapshotLoading) return;
	snapshotLoading = true;
	try {
		applySnapshot(await api.getLiveSnapshot());
	} catch {
		// Keep previous data on failure; next tick/reconnect retries
	} finally {
		snapshotLoading = false;
	}
}

function handleEvent(ev: SseEvent) {
	const payload = ev.data as Record<string, unknown>;
	switch (ev.type) {
		case 'live-tick': {
			const point = payload['point'] as LivePoint | undefined;
			if (point) {
				state.series = [...state.series, point].slice(-MAX_SERIES);
			}
			state.inFlight = (payload['inFlight'] as InFlightRequest[] | undefined) ?? [];
			state.inFlightTotal = (payload['inFlightTotal'] as number | undefined) ?? 0;
			const backends = payload['backends'] as
				| Array<{ backendId: string; concurrency: number; circuit: LiveBackendState['circuit'] }>
				| undefined;
			if (backends) {
				const next = new Map(state.backends);
				for (const b of backends) {
					const existing = next.get(b.backendId);
					next.set(b.backendId, {
						concurrency: b.concurrency,
						circuit: b.circuit,
						probes: existing?.probes ?? []
					});
				}
				state.backends = next;
			}
			state.lastTickAt = Date.now();
			break;
		}
		case 'request-start': {
			const entry = payload as unknown as InFlightRequest;
			if (!entry?.id) break;
			const next = state.inFlight.filter((r) => r.id !== entry.id);
			next.push(entry);
			next.sort((a, b) => a.startedAt - b.startedAt);
			state.inFlight = next.slice(-MAX_INFLIGHT);
			state.inFlightTotal = Math.max(state.inFlightTotal + 1, state.inFlight.length);
			break;
		}
		case 'request-end': {
			const id = payload['id'] as string | undefined;
			if (!id) break;
			state.inFlight = state.inFlight.filter((r) => r.id !== id);
			state.inFlightTotal = Math.max(0, state.inFlightTotal - 1);
			break;
		}
		case 'usage-event': {
			const parsed = parseMetricsEvent(payload);
			if (parsed) {
				state.recentEvents = [parsed, ...state.recentEvents].slice(0, MAX_RECENT_EVENTS);
			}
			break;
		}
		case 'backend-health': {
			const backendId = payload['backendId'] as string | undefined;
			const status = payload['status'] as LiveProbeSample['status'] | undefined;
			const latencyMs = payload['latencyMs'] as number | undefined;
			if (backendId && status && latencyMs != null) {
				const existing = state.backends.get(backendId);
				const probes = [...(existing?.probes ?? []), { t: Date.now(), status, latencyMs }];
				const next = new Map(state.backends);
				next.set(backendId, {
					concurrency: existing?.concurrency ?? 0,
					circuit: existing?.circuit ?? 'closed',
					probes: probes.slice(-MAX_PROBES)
				});
				state.backends = next;
			}
			break;
		}
	}
}

function mean(series: LivePoint[], count: number, pick: (p: LivePoint) => number): number {
	const slice = series.slice(-count);
	if (slice.length === 0) return 0;
	return slice.reduce((s, p) => s + pick(p), 0) / slice.length;
}

export const live = {
	get snapshot() {
		return state.snapshot;
	},
	get series() {
		return state.series;
	},
	get inFlight() {
		return state.inFlight;
	},
	get inFlightTotal() {
		return state.inFlightTotal;
	},
	get backends() {
		return state.backends;
	},
	get recentEvents() {
		return state.recentEvents;
	},
	get lastTickAt() {
		return state.lastTickAt;
	},

	/** Mean completed requests/s over the last 10 points. */
	get reqPerSec() {
		return mean(state.series, 10, (p) => p.completed);
	},
	/** Mean tokens/s over the last 5 points. */
	get tokensPerSec() {
		return mean(state.series, 5, (p) => p.tokens);
	},
	/** Errors over the last 60 points (per minute at 1 s resolution). */
	get errorsPerMin() {
		return state.series.slice(-60).reduce((s, p) => s + p.errors, 0);
	},
	get openCircuits() {
		let n = 0;
		for (const b of state.backends.values()) {
			if (b.circuit === 'open') n++;
		}
		return n;
	},
	uptimePct(backendId: string): number | null {
		const probes = state.backends.get(backendId)?.probes ?? [];
		if (probes.length === 0) return null;
		const healthy = probes.filter((p) => p.status === 'healthy').length;
		return healthy / probes.length;
	},

	/** Reference-counted activation — safe for multiple component mounts. */
	init(): void {
		refCount++;
		if (refCount > 1) return;

		void resync();

		let lastReconnect = sse.reconnectCount;
		unsubscribe = sse.subscribe((ev) => {
			handleEvent(ev);
			if (sse.reconnectCount !== lastReconnect) {
				lastReconnect = sse.reconnectCount;
				// In-flight rows may be stale after a disconnect — resync.
				void resync();
			}
		});
	},
	destroy(): void {
		refCount = Math.max(0, refCount - 1);
		if (refCount === 0 && unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}
	}
};

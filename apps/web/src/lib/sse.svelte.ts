import { browser } from '$app/environment';
import { getApiBaseUrl } from './api-base.js';

const SSE_EVENT_TYPES: Record<string, true> = {
	'backend-health': true,
	'vmodel-health': true,
	'usage-event': true,
	'key-event': true,
	log: true,
	system: true,
	'request-start': true,
	'request-end': true,
	'live-tick': true
};

/**
 * While the stream is down, probe a cheap HTTP endpoint every few seconds and
 * only re-establish the event stream once the server answers. A plain request
 * settles reliably even when a stale SSE connection is stuck half-open, so
 * recovery is detected by reachability rather than by the (possibly
 * black-holed) event-stream request itself.
 */
const RECONNECT_INTERVAL_MS = 5_000;
const PROBE_TIMEOUT_MS = 4_000;

/**
 * A connect attempt must not wedge reconnection forever. Intermediaries
 * (nginx, Tailscale, corporate proxies) can accept the connection and then
 * never answer, leaving `fetch` pending until the next probe abandons it.
 */
const CONNECT_TIMEOUT_MS = 10_000;

export interface SseEvent {
	type: string;
	data: unknown;
	timestamp: number | string;
}

function createSseStore() {
	let latestEvent = $state<SseEvent | null>(null);
	let connected = $state(false);
	let reconnectCount = $state(0);
	let abort: AbortController | null = null;
	let probeTimer: ReturnType<typeof setInterval> | null = null;
	let probing = false;
	let generation = 0;

	const listeners = new Set<(ev: SseEvent) => void>();

	function subscribe(handler: (ev: SseEvent) => void): () => void {
		listeners.add(handler);
		return () => listeners.delete(handler);
	}

	function startProbing() {
		if (probeTimer !== null) return;
		probeTimer = setInterval(() => {
			void probeAndReconnect();
		}, RECONNECT_INTERVAL_MS);
	}

	function stopProbing() {
		if (probeTimer !== null) {
			clearInterval(probeTimer);
			probeTimer = null;
		}
	}

	async function probeAndReconnect() {
		if (connected || probing) return;
		probing = true;
		try {
			let up = false;
			try {
				const res = await fetch(`${getApiBaseUrl()}/health`, {
					method: 'GET',
					signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
				});
				up = res.ok;
			} catch {
				// Still unreachable.
			}
			if (!up || connected) return;
			// The server answered — drop any attempt still stuck mid-connect
			// and open a fresh stream.
			abort?.abort();
			abort = null;
			void connect();
		} finally {
			probing = false;
		}
	}

	function dispatchParsed(raw: string) {
		try {
			latestEvent = JSON.parse(raw) as SseEvent;
		} catch {
			latestEvent = {
				type: 'raw',
				data: raw,
				timestamp: Date.now()
			};
		}
		// Invoke callback subscribers synchronously before the rune update
		// propagates — consecutive events within one microtask would otherwise
		// overwrite latestEvent and lose high-rate events.
		if (listeners.size > 0 && latestEvent) {
			for (const listener of listeners) {
				listener(latestEvent);
			}
		}
	}

	function handleBlock(block: string) {
		let eventType = 'message';
		const dataLines: string[] = [];

		for (const line of block.split('\n')) {
			if (line.startsWith('event:')) {
				eventType = line.slice(6).trim();
			} else if (line.startsWith('data:')) {
				dataLines.push(line.slice(5).trimStart());
			}
		}

		if (dataLines.length === 0) return;
		if (eventType !== 'message' && !Object.hasOwn(SSE_EVENT_TYPES, eventType)) return;

		dispatchParsed(dataLines.join('\n'));
	}

	async function readStream(body: ReadableStream<Uint8Array>) {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			buffer = buffer.replace(/\r\n/g, '\n');

			let sep: number;
			while ((sep = buffer.indexOf('\n\n')) !== -1) {
				const block = buffer.slice(0, sep).trim();
				buffer = buffer.slice(sep + 2);
				if (block) handleBlock(block);
			}
		}
	}

	async function connect() {
		if (!browser || abort) return;

		// Keep probing while disconnected even if this attempt hangs.
		startProbing();
		const myGen = ++generation;
		const controller = new AbortController();
		abort = controller;

		// Safety net: abandon an attempt whose headers never arrive.
		let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
			connectTimer = null;
			controller.abort();
		}, CONNECT_TIMEOUT_MS);

		try {
			const res = await fetch(`${getApiBaseUrl()}/api/v1/events`, {
				method: 'GET',
				credentials: 'include',
				headers: { Accept: 'text/event-stream' },
				signal: controller.signal
			});

			if (connectTimer !== null) {
				clearTimeout(connectTimer);
				connectTimer = null;
			}

			if (!res.ok || !res.body) {
				throw new Error(`SSE connection failed (${res.status})`);
			}

			if (myGen === generation) {
				const wasConnected = connected;
				connected = true;
				if (!wasConnected) reconnectCount++;
				stopProbing();
			}
			await readStream(res.body);
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return;
		} finally {
			if (connectTimer !== null) {
				clearTimeout(connectTimer);
				connectTimer = null;
			}
			if (abort === controller) abort = null;
			if (myGen !== generation) return;
			connected = false;
			// Network/auth failures and server-closed streams: keep polling.
			startProbing();
		}
	}

	function disconnect() {
		generation++;
		stopProbing();
		abort?.abort();
		abort = null;
		connected = false;
	}

	return {
		get latestEvent() {
			return latestEvent;
		},
		get connected() {
			return connected;
		},
		get reconnectCount() {
			return reconnectCount;
		},
		subscribe,
		connect,
		disconnect
	};
}

export const sse = createSseStore();

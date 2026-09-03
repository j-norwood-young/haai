import { browser } from '$app/environment';
import { getApiBaseUrl } from './api-base.js';

const SSE_EVENT_TYPES = new Set([
	'backend-health',
	'vmodel-health',
	'usage-event',
	'key-event',
	'log',
	'system',
	'request-start',
	'request-end',
	'live-tick'
]);

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
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let generation = 0;

	const listeners = new Set<(ev: SseEvent) => void>();

	function subscribe(handler: (ev: SseEvent) => void): () => void {
		listeners.add(handler);
		return () => listeners.delete(handler);
	}

	function clearReconnect() {
		if (reconnectTimer != null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	function scheduleReconnect() {
		clearReconnect();
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			void connect();
		}, 5000);
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
		if (eventType !== 'message' && !SSE_EVENT_TYPES.has(eventType)) return;

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

		clearReconnect();
		const myGen = ++generation;
		const controller = new AbortController();
		abort = controller;

		try {
			const res = await fetch(`${getApiBaseUrl()}/api/v1/events`, {
				method: 'GET',
				credentials: 'include',
				headers: { Accept: 'text/event-stream' },
				signal: controller.signal
			});

			if (!res.ok || !res.body) {
				throw new Error(`SSE connection failed (${res.status})`);
			}

			if (myGen === generation) {
				const wasConnected = connected;
				connected = true;
				if (!wasConnected) reconnectCount++;
			}
			await readStream(res.body);
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return;
		} finally {
			if (abort === controller) abort = null;
			if (myGen !== generation) return;
			connected = false;
			// Network/auth failures and server-closed streams should retry.
			scheduleReconnect();
		}
	}

	function disconnect() {
		generation++;
		clearReconnect();
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

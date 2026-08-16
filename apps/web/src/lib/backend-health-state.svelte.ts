import { api } from './api.js';
import {
	computeBackendHealth,
	type BackendHealthSnapshot
} from './backend-health.js';

const unavailable: BackendHealthSnapshot = {
	level: 'gray',
	summary: 'Backend health unavailable',
	backends: []
};

function createBackendHealthState() {
	let snapshot = $state<BackendHealthSnapshot>({
		level: 'gray',
		summary: 'Loading backend health',
		backends: []
	});
	let seq = 0;

	async function refresh() {
		const my = ++seq;
		try {
			const summary = await api.getMetricsSummary();
			if (my !== seq) return;
			snapshot = computeBackendHealth(summary.backends);
		} catch {
			if (my !== seq) return;
			snapshot = unavailable;
		}
	}

	function reset() {
		snapshot = {
			level: 'gray',
			summary: 'Loading backend health',
			backends: []
		};
	}

	return {
		get snapshot() {
			return snapshot;
		},
		refresh,
		reset
	};
}

/** Shared sidebar/dashboard backend health — refresh after backend mutations and on SSE. */
export const backendHealthState = createBackendHealthState();

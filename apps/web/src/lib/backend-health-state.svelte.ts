import { api } from './api.js';
import {
	computeSystemHealth,
	type SystemHealthSnapshot
} from './backend-health.js';

const unavailable: SystemHealthSnapshot = {
	level: 'gray',
	summary: 'Health unavailable',
	backends: [],
	vmodels: []
};

function createBackendHealthState() {
	let snapshot = $state<SystemHealthSnapshot>({
		level: 'gray',
		summary: 'Loading health',
		backends: [],
		vmodels: []
	});
	let seq = 0;

	async function refresh() {
		const my = ++seq;
		try {
			const summary = await api.getMetricsSummary();
			if (my !== seq) return;
			snapshot = computeSystemHealth(summary.backends, summary.vmodels ?? []);
		} catch {
			if (my !== seq) return;
			snapshot = unavailable;
		}
	}

	function reset() {
		snapshot = {
			level: 'gray',
			summary: 'Loading health',
			backends: [],
			vmodels: []
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

/** Shared sidebar health — backends + v-models; refresh on mutations and SSE. */
export const backendHealthState = createBackendHealthState();

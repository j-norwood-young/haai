export type BackendHealthLevel = 'green' | 'orange' | 'red' | 'gray';

export interface BackendHealthEntry {
	id: string;
	name: string;
	health: string;
	label: string;
	latency_ms?: number;
	error?: string;
	checked_at?: number;
}

export interface BackendHealthSnapshot {
	level: BackendHealthLevel;
	summary: string;
	backends: BackendHealthEntry[];
}

export interface BackendHealthInput {
	id: string;
	name: string;
	health: string;
	enabled?: boolean;
	latency_ms?: number;
	error?: string;
	checked_at?: number;
}

export interface BackendHealthDetails {
	id: string;
	name: string;
	health: string;
	latency_ms?: number;
	error?: string;
	checked_at?: string | number | null;
	url?: string;
}

function isHealthy(health: string): boolean {
	return health === 'healthy';
}

function formatHealthLabel(health: string): string {
	return health.charAt(0).toUpperCase() + health.slice(1);
}

export function healthBadgeClass(health: string): string {
	switch (health) {
		case 'healthy':
			return 'badge badge-green';
		case 'degraded':
			return 'badge badge-yellow';
		case 'unhealthy':
			return 'badge badge-red';
		default:
			return 'badge badge-gray';
	}
}

export function hasHealthDetails(health: string): boolean {
	return health === 'unhealthy' || health === 'degraded';
}

export function computeBackendHealth(backends: BackendHealthInput[]): BackendHealthSnapshot {
	const enabled = backends.filter((backend) => backend.enabled !== false);

	if (enabled.length === 0) {
		return {
			level: 'gray',
			summary: 'No backends configured',
			backends: []
		};
	}

	const entries: BackendHealthEntry[] = enabled.map((backend) => {
		const entry: BackendHealthEntry = {
			id: backend.id,
			name: backend.name,
			health: backend.health,
			label: formatHealthLabel(backend.health)
		};
		if (backend.latency_ms != null) entry.latency_ms = backend.latency_ms;
		if (backend.error) entry.error = backend.error;
		if (backend.checked_at != null) entry.checked_at = backend.checked_at;
		return entry;
	});

	const healthyCount = enabled.filter((backend) => isHealthy(backend.health)).length;

	if (healthyCount === enabled.length) {
		return {
			level: 'green',
			summary: 'All backends healthy',
			backends: entries
		};
	}

	if (healthyCount === 0) {
		return {
			level: 'red',
			summary: 'All backends down',
			backends: entries
		};
	}

	return {
		level: 'orange',
		summary: 'Some backends down',
		backends: entries
	};
}

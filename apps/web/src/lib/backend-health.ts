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

export interface VModelMappingHealthEntry {
	id: string;
	backendId: string;
	backendName: string;
	backendModelId: string;
	available: boolean | null;
	reason?: string;
}

export interface VModelHealthEntry {
	id: string;
	name: string;
	modelId: string;
	health: string;
	label: string;
	error?: string;
	checked_at?: number;
	mappings: VModelMappingHealthEntry[];
}

export interface SystemHealthSnapshot {
	level: BackendHealthLevel;
	summary: string;
	backends: BackendHealthEntry[];
	vmodels: VModelHealthEntry[];
}

/** @deprecated Prefer SystemHealthSnapshot */
export type BackendHealthSnapshot = SystemHealthSnapshot;

export interface BackendHealthInput {
	id: string;
	name: string;
	health: string;
	enabled?: boolean;
	latency_ms?: number;
	error?: string;
	checked_at?: number;
}

export interface VModelHealthInput {
	id: string;
	name: string;
	modelId: string;
	health: string;
	enabled?: boolean;
	error?: string;
	checked_at?: number;
	mappings?: Array<{
		id: string;
		backendId: string;
		backendName: string;
		backendModelId: string;
		available: boolean | null;
		reason?: string;
	}>;
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

export interface VModelHealthDetails {
	id: string;
	name: string;
	modelId: string;
	health: string;
	error?: string;
	checked_at?: string | number | null;
	mappings: VModelMappingHealthEntry[];
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

export function mappingReasonLabel(reason: string | undefined, backendModelId: string): string {
	switch (reason) {
		case 'backend_disabled':
			return 'Backend disabled';
		case 'backend_unhealthy':
			return 'Backend unhealthy';
		case 'model_missing':
			return `Model '${backendModelId}' not loaded`;
		case 'inventory_unknown':
			return 'Model inventory unknown';
		default:
			return reason || 'Unavailable';
	}
}

function levelRank(level: BackendHealthLevel): number {
	switch (level) {
		case 'red':
			return 3;
		case 'orange':
			return 2;
		case 'gray':
			return 1;
		default:
			return 0;
	}
}

function worstLevel(a: BackendHealthLevel, b: BackendHealthLevel): BackendHealthLevel {
	return levelRank(a) >= levelRank(b) ? a : b;
}

function computeBackendSlice(backends: BackendHealthInput[]): {
	level: BackendHealthLevel;
	summary: string;
	entries: BackendHealthEntry[];
} {
	const enabled = backends.filter((backend) => backend.enabled !== false);

	if (enabled.length === 0) {
		return { level: 'gray', summary: 'No backends configured', entries: [] };
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
		return { level: 'green', summary: 'All backends healthy', entries };
	}
	if (healthyCount === 0) {
		return { level: 'red', summary: 'All backends down', entries };
	}
	return { level: 'orange', summary: 'Some backends down', entries };
}

function computeVModelSlice(vmodels: VModelHealthInput[]): {
	level: BackendHealthLevel;
	summary: string;
	entries: VModelHealthEntry[];
} {
	const enabled = vmodels.filter((vm) => vm.enabled !== false);

	if (enabled.length === 0) {
		return { level: 'gray', summary: 'No v-models configured', entries: [] };
	}

	const entries: VModelHealthEntry[] = enabled.map((vm) => {
		const entry: VModelHealthEntry = {
			id: vm.id,
			name: vm.name,
			modelId: vm.modelId,
			health: vm.health,
			label: formatHealthLabel(vm.health),
			mappings: (vm.mappings ?? []).map((m) => {
				const mapping: VModelMappingHealthEntry = {
					id: m.id,
					backendId: m.backendId,
					backendName: m.backendName,
					backendModelId: m.backendModelId,
					available: m.available
				};
				if (m.reason) mapping.reason = m.reason;
				return mapping;
			})
		};
		if (vm.error) entry.error = vm.error;
		if (vm.checked_at != null) entry.checked_at = vm.checked_at;
		return entry;
	});

	const healthyCount = enabled.filter((vm) => isHealthy(vm.health)).length;
	const unhealthyCount = enabled.filter((vm) => vm.health === 'unhealthy').length;
	const degradedCount = enabled.filter((vm) => vm.health === 'degraded').length;

	if (healthyCount === enabled.length) {
		return { level: 'green', summary: 'All v-models healthy', entries };
	}
	if (unhealthyCount === enabled.length) {
		return { level: 'red', summary: 'All v-models down', entries };
	}
	if (degradedCount > 0 || unhealthyCount > 0) {
		const bits: string[] = [];
		if (degradedCount > 0) bits.push(`${degradedCount} degraded`);
		if (unhealthyCount > 0) bits.push(`${unhealthyCount} down`);
		return { level: 'orange', summary: `V-models: ${bits.join(', ')}`, entries };
	}
	return { level: 'gray', summary: 'V-model health unknown', entries };
}

export function computeSystemHealth(
	backends: BackendHealthInput[],
	vmodels: VModelHealthInput[] = []
): SystemHealthSnapshot {
	const backendSlice = computeBackendSlice(backends);
	const vmodelSlice = computeVModelSlice(vmodels);

	const hasBackends = backendSlice.entries.length > 0;
	const hasVmodels = vmodelSlice.entries.length > 0;

	if (!hasBackends && !hasVmodels) {
		return {
			level: 'gray',
			summary: 'No backends or v-models configured',
			backends: [],
			vmodels: []
		};
	}

	let level: BackendHealthLevel = 'green';
	if (hasBackends) level = worstLevel(level, backendSlice.level);
	if (hasVmodels) level = worstLevel(level, vmodelSlice.level);

	const parts: string[] = [];
	if (hasBackends) parts.push(backendSlice.summary);
	if (hasVmodels) parts.push(vmodelSlice.summary);

	return {
		level,
		summary: parts.join(' · '),
		backends: backendSlice.entries,
		vmodels: vmodelSlice.entries
	};
}

/** Back-compat wrapper used by older call sites. */
export function computeBackendHealth(backends: BackendHealthInput[]): SystemHealthSnapshot {
	return computeSystemHealth(backends, []);
}

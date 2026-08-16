import { getApiBaseUrl } from './api-base.js';
import { ApiHttpError, apiFetch } from '@ai-v-models/core/http';
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/browser';

interface BackendApiRow {
	id: string;
	name: string;
	displayName: string;
	hostName: string;
	provider: string;
	baseUrl: string;
	keyMode: string;
	enabled: boolean;
	lastHealthStatus: 'healthy' | 'degraded' | 'unhealthy' | null;
	lastLatencyMs: number | null;
	lastHealthError: string | null;
	lastHealthCheck: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface Backend {
	id: string;
	name: string;
	provider: string;
	host: string;
	url: string;
	api_key?: string;
	health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
	latency_ms?: number;
	health_error?: string;
	checked_at?: string;
	enabled: boolean;
	created_at: string;
	updated_at: string;
}

export interface BackendInput {
	name: string;
	provider: string;
	host: string;
	url: string;
	api_key?: string;
}

function mapBackend(row: BackendApiRow): Backend {
	const backend: Backend = {
		id: row.id,
		name: row.displayName || row.name,
		provider: row.provider,
		host: row.hostName,
		url: row.baseUrl,
		health: row.lastHealthStatus ?? 'unknown',
		enabled: row.enabled,
		created_at: new Date(row.createdAt).toISOString(),
		updated_at: new Date(row.updatedAt).toISOString()
	};
	if (row.lastLatencyMs != null) backend.latency_ms = row.lastLatencyMs;
	if (row.lastHealthError) backend.health_error = row.lastHealthError;
	if (row.lastHealthCheck != null) backend.checked_at = new Date(row.lastHealthCheck).toISOString();
	return backend;
}

function toCreatePayload(data: BackendInput): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		name: data.name,
		displayName: data.name,
		hostName: data.host,
		provider: data.provider,
		baseUrl: data.url
	};
	if (data.api_key) {
		payload.apiKey = data.api_key;
		payload.keyMode = 'abstraction';
	}
	return payload;
}

function mapBackendTestResult(result: {
	success: boolean;
	latencyMs?: number;
	health?: 'healthy' | 'degraded' | 'unhealthy';
	error?: string;
}): {
	success: boolean;
	latency_ms?: number;
	health?: 'healthy' | 'degraded' | 'unhealthy';
	error?: string;
} {
	const mapped: {
		success: boolean;
		latency_ms?: number;
		health?: 'healthy' | 'degraded' | 'unhealthy';
		error?: string;
	} = { success: result.success };
	if (result.latencyMs !== undefined) mapped.latency_ms = result.latencyMs;
	if (result.health !== undefined) mapped.health = result.health;
	if (result.error !== undefined) mapped.error = result.error;
	return mapped;
}

export type VModelStrategy =
	| 'session-pin'
	| 'round-robin'
	| 'weighted'
	| 'least-connections'
	| 'least-latency';

export interface VModel {
	id: string;
	model_id: string;
	display_name: string;
	strategy: VModelStrategy;
	streaming: boolean;
	enabled: boolean;
	health?: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
	health_error?: string;
	health_checked_at?: number;
	backends: VModelBackend[];
	created_at: string;
}

export interface VModelBackend {
	id: string;
	backend_id: string;
	backend_model_id: string;
	backend_name?: string;
	weight?: number;
	available?: boolean | null;
	unavailable_reason?: string;
}

interface VModelApiRow {
	id: string;
	modelId: string;
	displayName: string;
	balancingStrategy: string;
	streaming: boolean;
	enabled: boolean;
	lastHealthStatus?: string | null;
	lastHealthError?: string | null;
	lastHealthCheck?: number | null;
	backends?: VModelBackendApiRow[];
	createdAt: number;
}

interface VModelBackendApiRow {
	id: string;
	backendId: string;
	backendModelId: string;
	backendName?: string;
	weight: number;
	lastAvailable?: boolean | null;
	unavailableReason?: string | null;
}

function mapVModelBackend(row: VModelBackendApiRow): VModelBackend {
	const mapped: VModelBackend = {
		id: row.id,
		backend_id: row.backendId,
		backend_model_id: row.backendModelId,
		weight: row.weight
	};
	if (row.backendName) mapped.backend_name = row.backendName;
	if (row.lastAvailable !== undefined) mapped.available = row.lastAvailable;
	if (row.unavailableReason) mapped.unavailable_reason = row.unavailableReason;
	return mapped;
}

function mapVModel(row: VModelApiRow): VModel {
	const mapped: VModel = {
		id: row.id,
		model_id: row.modelId,
		display_name: row.displayName,
		strategy: row.balancingStrategy as VModelStrategy,
		streaming: row.streaming,
		enabled: row.enabled,
		backends: (row.backends ?? []).map(mapVModelBackend),
		created_at: new Date(row.createdAt).toISOString()
	};
	const status = row.lastHealthStatus;
	if (
		status === 'healthy' ||
		status === 'degraded' ||
		status === 'unhealthy' ||
		status === 'unknown'
	) {
		mapped.health = status;
	}
	if (row.lastHealthError) mapped.health_error = row.lastHealthError;
	if (row.lastHealthCheck != null) mapped.health_checked_at = row.lastHealthCheck;
	return mapped;
}

export interface VModelCreateInput {
	model_id: string;
	display_name: string;
	strategy?: VModelStrategy;
	streaming?: boolean;
	enabled?: boolean;
	backends?: Array<Pick<VModelBackend, 'backend_id' | 'backend_model_id' | 'weight'>>;
}

function toCreateVModelPayload(data: VModelCreateInput): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	if (data.model_id) payload.modelId = data.model_id;
	if (data.display_name) payload.displayName = data.display_name;
	if (data.strategy) payload.balancingStrategy = data.strategy;
	if (data.streaming !== undefined) payload.streaming = data.streaming;
	if (data.enabled !== undefined) payload.enabled = data.enabled;
	if (data.backends?.length) {
		payload.backends = data.backends.map((b) => ({
			backendId: b.backend_id,
			backendModelId: b.backend_model_id,
			weight: b.weight ?? 1
		}));
	}
	return payload;
}

function toUpdateVModelPayload(data: Partial<VModel>): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	if (data.display_name !== undefined) payload.displayName = data.display_name;
	if (data.strategy !== undefined) payload.balancingStrategy = data.strategy;
	if (data.streaming !== undefined) payload.streaming = data.streaming;
	if (data.enabled !== undefined) payload.enabled = data.enabled;
	return payload;
}

export interface ApiKey {
	id: string;
	key_prefix: string;
	name: string;
	enabled: boolean;
	suspended: boolean;
	suspended_reason?: string;
	rpm_limit?: number;
	day_budget?: number;
	allowed_vmodels?: string[] | null | undefined;
	allowed_backends?: string[] | null | undefined;
	expires_at?: string;
	last_used_at?: string;
	created_at: string;
	retrievable: boolean;
}

interface ApiKeyApiRow {
	id: string;
	prefix: string;
	name: string;
	enabled: boolean;
	suspended: boolean;
	suspendedReason?: string | null;
	rateLimitRpm?: number | null;
	tokenBudgetDay?: number | null;
	allowedModels?: string | null;
	allowedBackends?: string | null;
	expiresAt?: number | null;
	lastUsedAt?: number | null;
	createdAt: number;
	retrievable?: boolean;
}

function mapApiKey(row: ApiKeyApiRow): ApiKey {
	let allowedModels: string[] | undefined;
	if (row.allowedModels) {
		try {
			allowedModels = JSON.parse(row.allowedModels) as string[];
		} catch {
			allowedModels = undefined;
		}
	}

	let allowedBackends: string[] | undefined;
	if (row.allowedBackends) {
		try {
			allowedBackends = JSON.parse(row.allowedBackends) as string[];
		} catch {
			allowedBackends = undefined;
		}
	}

	const key: ApiKey = {
		id: row.id,
		key_prefix: row.prefix,
		name: row.name,
		enabled: row.enabled,
		suspended: row.suspended,
		created_at: new Date(row.createdAt).toISOString(),
		retrievable: row.retrievable ?? false
	};
	if (row.suspendedReason) key.suspended_reason = row.suspendedReason;
	if (row.rateLimitRpm != null) key.rpm_limit = row.rateLimitRpm;
	if (row.tokenBudgetDay != null) key.day_budget = row.tokenBudgetDay;
	if (allowedModels) key.allowed_vmodels = allowedModels;
	if (allowedBackends) key.allowed_backends = allowedBackends;
	if (row.expiresAt != null) key.expires_at = new Date(row.expiresAt).toISOString();
	if (row.lastUsedAt != null) key.last_used_at = new Date(row.lastUsedAt).toISOString();
	return key;
}

function toCreateKeyPayload(data: Partial<ApiKey>): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	if (data.name !== undefined) payload.name = data.name;
	if (data.enabled !== undefined) payload.enabled = data.enabled;
	if (data.rpm_limit !== undefined) payload.rateLimitRpm = data.rpm_limit;
	if (data.day_budget !== undefined) payload.tokenBudgetDay = data.day_budget;
	if (data.expires_at !== undefined) {
		payload.expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
	}
	if ('allowed_vmodels' in data) {
		payload.allowedModels = data.allowed_vmodels ?? null;
	}
	if ('allowed_backends' in data) {
		payload.allowedBackends = data.allowed_backends ?? null;
	}
	return payload;
}

function toUpdateKeyPayload(data: Partial<ApiKey>): Record<string, unknown> {
	return toCreateKeyPayload(data);
}

export interface AppSettings {
	apiKeys: {
		showOnce: boolean;
	};
}

interface KeyLogApiRow {
	id: string;
	keyId: string;
	endpoint: string;
	statusCode: number;
	promptTokens: number;
	completionTokens: number;
	durationMs: number;
	tps: number | null;
	error: string | null;
	timestamp: number;
}

export interface KeyLog {
	id: string;
	key_id: string;
	endpoint: string;
	status_code: number;
	tokens_in?: number;
	tokens_out?: number;
	duration_ms?: number;
	tps?: number;
	error?: string;
	created_at: string;
}

function mapKeyLog(row: KeyLogApiRow): KeyLog {
	const log: KeyLog = {
		id: row.id,
		key_id: row.keyId,
		endpoint: row.endpoint,
		status_code: row.statusCode,
		tokens_in: row.promptTokens,
		tokens_out: row.completionTokens,
		duration_ms: row.durationMs,
		created_at: new Date(row.timestamp).toISOString()
	};
	if (row.tps != null) log.tps = row.tps;
	if (row.error) log.error = row.error;
	return log;
}

export function parseKeyLog(data: unknown): KeyLog | null {
	if (!data || typeof data !== 'object') return null;
	return mapKeyLog(data as KeyLogApiRow);
}

interface MetricsEventApiRow {
	id: string;
	keyPrefix?: string | null;
	vmodel?: string;
	endpoint: string;
	statusCode: number;
	totalTokens?: number;
	durationMs?: number;
	tps?: number | null;
	error?: string | null;
	timestamp: number;
}

function mapMetricsEvent(row: MetricsEventApiRow): MetricsEvent {
	const event: MetricsEvent = {
		id: row.id,
		key_prefix: row.keyPrefix ?? 'unknown',
		vmodel: row.vmodel ?? 'unknown',
		endpoint: row.endpoint,
		status_code: row.statusCode,
		created_at: new Date(row.timestamp).toISOString()
	};
	if (row.totalTokens !== undefined) event.tokens = row.totalTokens;
	if (row.durationMs !== undefined) event.duration_ms = row.durationMs;
	if (row.tps != null) event.tps = row.tps;
	if (row.error) event.error = row.error;
	return event;
}

export function parseMetricsEvent(data: unknown): MetricsEvent | null {
	if (!data || typeof data !== 'object') return null;
	return mapMetricsEvent(data as MetricsEventApiRow);
}

export interface KeyBudget {
	key_id: string;
	day_budget?: number;
	day_used: number;
	rpm_limit?: number;
	rpm_current: number;
}

export interface Hook {
	id: string;
	name: string;
	type: 'webhook' | 'internal';
	trigger: string;
	enabled: boolean;
	url?: string;
	module?: string;
	created_at: string;
}

// ── Plugins ──────────────────────────────────────────────────────────────────

export type ConfigFieldType = 'string' | 'text' | 'number' | 'boolean' | 'select' | 'secret' | 'model' | 'backend';

export interface ConfigField {
	type: ConfigFieldType;
	label: string;
	description?: string;
	required?: boolean;
	default?: unknown;
	options?: string[]; // for select
	min?: number;
	max?: number;
}

export type ConfigSchema = Record<string, ConfigField>;

export interface PluginManifest {
	name: string;
	description?: string;
	version: string;
	hooks: Array<'onRequest' | 'onResponse'>;
	needsResponseBuffer?: boolean;
}

export interface Plugin {
	id: string;
	name: string;
	description: string | null;
	source: string;
	version: string | null;
	manifest: PluginManifest;
	configSchema: ConfigSchema | null;
	bundlePath: string | null;
	needsResponseBuffer: boolean;
	enabled: boolean;
	createdAt: number;
	updatedAt: number;
}

export type PluginScopeType = 'global' | 'vmodel' | 'backend' | 'key';

export interface PluginBinding {
	id: string;
	pluginId: string;
	scopeType: PluginScopeType;
	scopeId: string | null;
	config: Record<string, unknown> | null;
	order: number;
	enabled: boolean;
	createdAt: number;
}

export interface AvailableModel {
	id: string;
	ownedBy: string;
	backendId?: string;
	backendName?: string;
	type: 'backend-model' | 'vmodel';
}

export interface MetricsSummary {
	total_requests_24h: number;
	total_tokens_24h: number;
	error_rate_24h: number;
	avg_ttft_ms?: number;
	avg_tps?: number;
	backends: BackendHealth[];
	vmodels?: VModelHealthSummary[];
}

export interface BackendHealth {
	id: string;
	name: string;
	health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
	latency_ms?: number;
	error?: string;
	checked_at?: number;
	enabled?: boolean;
}

export interface VModelHealthMapping {
	id: string;
	backendId: string;
	backendName: string;
	backendModelId: string;
	available: boolean | null;
	reason?: string;
}

export interface VModelHealthSummary {
	id: string;
	name: string;
	modelId: string;
	health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
	enabled?: boolean;
	error?: string;
	checked_at?: number;
	mappings?: VModelHealthMapping[];
}

export interface MetricsRollup {
	timestamp: string;
	requests: number;
	tokens: number;
	errors: number;
	avg_latency_ms?: number;
}

export interface MetricsEvent {
	id: string;
	key_prefix: string;
	vmodel: string;
	endpoint: string;
	status_code: number;
	tokens?: number;
	duration_ms?: number;
	tps?: number;
	error?: string;
	created_at: string;
}

export interface MetricsFilters {
	keyId?: string;
	vmodelId?: string;
	backendId?: string;
	backendModelId?: string;
}

function metricsFiltersQuery(params?: MetricsFilters): string {
	if (!params) return '';
	return new URLSearchParams(
		Object.entries(params)
			.filter(([, v]) => v !== undefined && v !== '')
			.map(([k, v]) => [k, String(v)])
	).toString();
}

export interface User {
	id: string;
	username: string;
	displayName?: string;
	role: string;
	mustChangePassword?: boolean;
	totpEnabled?: boolean;
}

export interface LoginResult {
	user: User;
	requiresTotp?: boolean;
	pendingToken?: string;
}

class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
	const { json, ...fetchInit } = init ?? {};
	try {
		return await apiFetch<T>(`${getApiBaseUrl()}/api/v1${path}`, {
			...fetchInit,
			method: fetchInit.method ?? 'GET',
			credentials: 'include',
			body: json !== undefined ? json : fetchInit.body,
		});
	} catch (err) {
		if (err instanceof ApiHttpError) {
			throw new ApiError(err.status, err.message);
		}
		throw err;
	}
}

export const api = {
	// Backends
	getBackends: async () => {
		const rows = await request<BackendApiRow[]>('/backends');
		return rows.map(mapBackend);
	},
	addBackend: async (data: BackendInput) => {
		const row = await request<BackendApiRow>('/backends', {
			method: 'POST',
			json: toCreatePayload(data)
		});
		return mapBackend(row);
	},
	updateBackend: async (
		id: string,
		data: Partial<Pick<Backend, 'name' | 'url' | 'enabled'>> & { api_key?: string }
	) => {
		const payload: Record<string, unknown> = {};
		if (data.name !== undefined) payload.displayName = data.name;
		if (data.url !== undefined) payload.baseUrl = data.url;
		if (data.enabled !== undefined) payload.enabled = data.enabled;
		if (data.api_key) {
			payload.apiKey = data.api_key;
			payload.keyMode = 'abstraction';
		}
		const row = await request<BackendApiRow>(`/backends/${id}`, {
			method: 'PATCH',
			json: payload
		});
		return mapBackend(row);
	},
	getBackend: async (id: string) => {
		const row = await request<BackendApiRow>(`/backends/${id}`);
		return mapBackend(row);
	},
	deleteBackend: (id: string) => request<void>(`/backends/${id}`, { method: 'DELETE' }),
	testBackend: async (
		id: string,
		overrides?: { url?: string; api_key?: string }
	) => {
		const json: Record<string, unknown> = {};
		if (overrides?.url) json.baseUrl = overrides.url;
		if (overrides?.api_key) json.apiKey = overrides.api_key;
		return mapBackendTestResult(
			await request<{
				success: boolean;
				latencyMs?: number;
				health?: 'healthy' | 'degraded' | 'unhealthy';
				error?: string;
			}>(`/backends/${id}/test`, {
				method: 'POST',
				...(Object.keys(json).length > 0 ? { json } : {})
			})
		);
	},
	/** Probe connectivity for unsaved backend form values (no backend id). */
	testBackendDraft: async (data: { url: string; api_key?: string }) => {
		const json: Record<string, unknown> = { baseUrl: data.url };
		if (data.api_key) json.apiKey = data.api_key;
		return mapBackendTestResult(
			await request<{
				success: boolean;
				latencyMs?: number;
				health?: 'healthy' | 'degraded' | 'unhealthy';
				error?: string;
			}>('/backends/test', { method: 'POST', json })
		);
	},

	// Virtual Models
	getVModels: async () => {
		const rows = await request<VModelApiRow[]>('/vmodels');
		return rows.map(mapVModel);
	},
	createVModel: async (data: VModelCreateInput) => {
		const row = await request<VModelApiRow>('/vmodels', {
			method: 'POST',
			json: toCreateVModelPayload(data)
		});
		return mapVModel(row);
	},
	getVModel: async (id: string) => {
		const row = await request<VModelApiRow>(`/vmodels/${id}`);
		return mapVModel(row);
	},
	updateVModel: async (id: string, data: Partial<VModel>) => {
		await request<{ success: boolean }>(`/vmodels/${id}`, {
			method: 'PATCH',
			json: toUpdateVModelPayload(data)
		});
		const row = await request<VModelApiRow>(`/vmodels/${id}`);
		return mapVModel(row);
	},
	deleteVModel: (id: string) => request<void>(`/vmodels/${id}`, { method: 'DELETE' }),
	addVModelBackend: (
		vmodelId: string,
		data: Pick<VModelBackend, 'backend_id' | 'backend_model_id'> & { weight?: number }
	) =>
		request<{ success: boolean }>(`/vmodels/${vmodelId}/backends`, {
			method: 'POST',
			json: {
				backendId: data.backend_id,
				backendModelId: data.backend_model_id,
				weight: data.weight
			}
		}),
	removeVModelBackend: (vmodelId: string, backendMappingId: string) =>
		request<void>(`/vmodels/${vmodelId}/backends/${backendMappingId}`, { method: 'DELETE' }),
	updateVModelBackendWeight: (
		vmodelId: string,
		backendMappingId: string,
		weight: number
	) =>
		request<{ success: boolean }>(`/vmodels/${vmodelId}/backends/${backendMappingId}`, {
			method: 'PATCH',
			json: { weight }
		}),

	// Keys
	getKeys: async () => {
		const rows = await request<ApiKeyApiRow[]>('/keys');
		return rows.map(mapApiKey);
	},
	getKey: async (id: string) => mapApiKey(await request<ApiKeyApiRow>(`/keys/${id}`)),
	createKey: async (data: Partial<ApiKey>) => {
		const result = await request<ApiKeyApiRow & { key: string; showOnce?: boolean }>('/keys', {
			method: 'POST',
			json: toCreateKeyPayload(data)
		});
		return { ...mapApiKey(result), key: result.key, showOnce: result.showOnce ?? false };
	},
	revealKey: async (id: string) => {
		const result = await request<{ key: string }>(`/keys/${id}/secret`);
		return result.key;
	},
	updateKey: (id: string, data: Partial<ApiKey>) =>
		request<{ success: boolean }>(`/keys/${id}`, { method: 'PATCH', json: toUpdateKeyPayload(data) }),
	suspendKey: (id: string, reason: string) =>
		request<ApiKey>(`/keys/${id}/suspend`, { method: 'POST', json: { reason } }),
	resumeKey: (id: string) => request<ApiKey>(`/keys/${id}/resume`, { method: 'POST' }),
	deleteKey: (id: string) => request<void>(`/keys/${id}`, { method: 'DELETE' }),
	getKeyLogs: async (id: string, limit = 100) => {
		const rows = await request<KeyLogApiRow[]>(`/keys/${id}/logs?limit=${limit}`);
		return rows.map(mapKeyLog);
	},
	getKeyBudget: (id: string) => request<KeyBudget>(`/keys/${id}/budget`),

	// Hooks
	getHooks: () => request<Hook[]>('/hooks'),
	getHook: (id: string) => request<Hook>(`/hooks/${id}`),
	createHook: (data: Partial<Hook>) =>
		request<Hook>('/hooks', { method: 'POST', json: data }),
	updateHook: (id: string, data: Partial<Pick<Hook, 'name' | 'enabled'>>) =>
		request<{ success: boolean }>(`/hooks/${id}`, { method: 'PATCH', json: data }),
	deleteHook: (id: string) => request<void>(`/hooks/${id}`, { method: 'DELETE' }),
	testHook: (id: string) =>
		request<{ success: boolean; error?: string }>(`/hooks/${id}/test`, { method: 'POST' }),

	// Metrics
	getMetricsSummary: (params?: MetricsFilters) => {
		const qs = metricsFiltersQuery(params);
		return request<MetricsSummary>(`/metrics/summary${qs ? `?${qs}` : ''}`);
	},
	getMetricsRollups: (params: {
		period?: string;
		limit?: number;
		since?: string;
	} & MetricsFilters) => {
		const qs = new URLSearchParams(
			Object.entries(params)
				.filter(([, v]) => v !== undefined && v !== '')
				.map(([k, v]) => [k, String(v)])
		).toString();
		return request<MetricsRollup[]>(`/metrics/rollups${qs ? `?${qs}` : ''}`);
	},
	getMetricsEvents: async (
		params: { limit?: number; since?: string } & MetricsFilters = {}
	) => {
		const qs = new URLSearchParams(
			Object.entries(params)
				.filter(([, v]) => v !== undefined && v !== '')
				.map(([k, v]) => [k, String(v)])
		).toString();
		const rows = await request<MetricsEventApiRow[]>(`/metrics/events${qs ? `?${qs}` : ''}`);
		return rows.map(mapMetricsEvent);
	},

	// Auth
	login: async (username: string, password: string) => {
		return request<LoginResult>('/auth/login', {
			method: 'POST',
			json: { username, password }
		});
	},
	verifyTotp: async (pendingToken: string, code: string) => {
		const res = await request<{ user: User; expiresAt: number }>('/auth/verify-totp', {
			method: 'POST',
			json: { pendingToken, code }
		});
		return res.user;
	},
	logout: () => request<void>('/auth/logout', { method: 'POST' }),
	getMe: () => request<User>('/auth/me'),
	changePassword: (currentPassword: string, newPassword: string) =>
		request<{ success: boolean; user: User }>('/auth/change-password', {
			method: 'POST',
			json: { currentPassword, newPassword }
		}),
	setupTotp: () =>
		request<{ secret: string; otpauthUrl: string }>('/auth/totp/setup', { method: 'POST' }),
	enableTotp: (secret: string, code: string) =>
		request<{ success: boolean; totpEnabled: boolean }>('/auth/totp/enable', {
			method: 'POST',
			json: { secret, code }
		}),
	disableTotp: (code: string) =>
		request<{ success: boolean; totpEnabled: boolean }>('/auth/totp/disable', {
			method: 'POST',
			json: { code }
		}),
	createAdminToken: (name: string, expiresInDays?: number) =>
		request<{ id: string; name: string; prefix: string; token: string }>('/admin-tokens', {
			method: 'POST',
			json: { name, expiresInDays }
		}),
	listAdminTokens: () =>
		request<
			Array<{
				id: string;
				name: string;
				prefix: string;
				enabled: boolean;
				expiresAt: number | null;
			}>
		>('/admin-tokens'),
	revokeAdminToken: (id: string) =>
		request<{ success: boolean }>(`/admin-tokens/${id}`, { method: 'DELETE' }),

	// Passkeys (WebAuthn)
	webauthnRegisterOptions: (name?: string) =>
		request<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>(
			'/auth/webauthn/register/options',
			{ method: 'POST', json: { name } }
		),
	webauthnRegisterVerify: (challengeId: string, response: unknown, name?: string) =>
		request<{ success: boolean; name: string }>('/auth/webauthn/register/verify', {
			method: 'POST',
			json: { challengeId, response, name }
		}),
	webauthnLoginOptions: (username?: string) =>
		request<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>(
			'/auth/webauthn/login/options',
			{ method: 'POST', json: { username } }
		),
	webauthnLoginVerify: (challengeId: string, response: unknown, username?: string) =>
		request<{ user: User; expiresAt: number }>('/auth/webauthn/login/verify', {
			method: 'POST',
			json: { challengeId, response, username }
		}),
	webauthnAvailable: (username: string) =>
		request<{ available: boolean }>(
			`/auth/webauthn/available?username=${encodeURIComponent(username)}`
		),
	listPasskeys: () =>
		request<
			Array<{
				id: string;
				name: string;
				deviceType: string;
				backedUp: boolean;
				createdAt: number;
				lastUsedAt: number | null;
			}>
		>('/auth/webauthn/credentials'),
	deletePasskey: (id: string) =>
		request<{ success: boolean }>(`/auth/webauthn/credentials/${id}`, { method: 'DELETE' }),

	// Plugins
	getPlugins: () => request<Plugin[]>('/plugins'),
	getPlugin: (id: string) => request<Plugin & { bindings: PluginBinding[] }>(`/plugins/${id}`),
	installPlugin: (source: string, name?: string) =>
		request<Plugin>('/plugins', { method: 'POST', json: { source, name } }),
	updatePlugin: (id: string, data: Partial<Pick<Plugin, 'name' | 'description' | 'enabled'>>) =>
		request<{ success: boolean }>(`/plugins/${id}`, { method: 'PATCH', json: data }),
	reinstallPlugin: (id: string) =>
		request<{ success: boolean }>(`/plugins/${id}/reinstall`, { method: 'POST' }),
	deletePlugin: (id: string) => request<void>(`/plugins/${id}`, { method: 'DELETE' }),

	getPluginBindings: (pluginId: string) =>
		request<PluginBinding[]>(`/plugins/${pluginId}/bindings`),
	createBinding: (
		pluginId: string,
		data: { scopeType: PluginScopeType; scopeId?: string | null; config?: Record<string, unknown> | null; order?: number }
	) => request<PluginBinding>(`/plugins/${pluginId}/bindings`, { method: 'POST', json: data }),
	updateBinding: (
		pluginId: string,
		bindingId: string,
		data: Partial<Pick<PluginBinding, 'enabled' | 'config' | 'order'>>
	) => request<{ success: boolean }>(`/plugins/${pluginId}/bindings/${bindingId}`, { method: 'PATCH', json: data }),
	deleteBinding: (pluginId: string, bindingId: string) =>
		request<void>(`/plugins/${pluginId}/bindings/${bindingId}`, { method: 'DELETE' }),

	getAvailableModels: () => request<{ models: AvailableModel[] }>('/available-models'),

	// Settings
	getSettings: () => request<AppSettings>('/settings'),
	updateSettings: (data: Partial<AppSettings>) =>
		request<AppSettings>('/settings', { method: 'PATCH', json: data })
};

export { ApiError };

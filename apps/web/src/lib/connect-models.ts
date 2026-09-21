import type { AvailableModel, VModel } from '$lib/api.js';
import { vModelMatchesAllowList } from '$lib/vmodel-utils.js';

/** A model an API key can call, as offered by the Connect modal. */
export interface ConnectModel {
	/** The `model` value to send: a v-model alias or a `model:host:provider` pass-through id. */
	id: string;
	source: 'vmodel' | 'passthrough';
	/** Which inference endpoint serves it. */
	kind: 'chat' | 'embedding';
	/** Whether requests can succeed (a v-model with no backends cannot). */
	ready: boolean;
	streaming: boolean;
	/** Set for v-models only. */
	vmodel: VModel | null;
	/** Human-readable name shown in the picker. */
	label: string;
}

/**
 * Models a key may call. Allow-lists follow the proxy: null/undefined means
 * unrestricted, and an empty list means none.
 */
export function buildConnectModels(
	vmodels: VModel[],
	available: AvailableModel[],
	allowedVModels: string[] | null | undefined,
	allowedBackends: string[] | null | undefined
): ConnectModel[] {
	const fromVModels: ConnectModel[] = vmodels
		.filter((vm) => vm.enabled && (allowedVModels == null || vModelMatchesAllowList(vm, allowedVModels)))
		.map((vm) => ({
			id: vm.model_id,
			source: 'vmodel',
			kind: vm.kind,
			ready: vm.backends.length > 0,
			streaming: vm.streaming,
			vmodel: vm,
			label:
				vm.display_name && vm.display_name !== vm.model_id
					? `${vm.display_name} (${vm.model_id})`
					: vm.model_id
		}));

	const fromBackends: ConnectModel[] = available
		.filter(
			(m) =>
				m.type === 'backend-model' &&
				m.backendId != null &&
				(allowedBackends == null || allowedBackends.includes(m.backendId))
		)
		.map((m) => ({
			id: m.id,
			source: 'passthrough',
			kind: m.modelKind === 'embeddings' ? 'embedding' : 'chat',
			ready: true,
			streaming: true,
			vmodel: null,
			label: m.id
		}));

	return [...fromVModels, ...fromBackends];
}

export type ConnectAvailabilityIssue = 'none' | 'key_restricted';

/** Why no model can be offered at all, or null when the key can call something. */
export function getConnectAvailabilityIssue(
	vmodels: VModel[],
	available: AvailableModel[],
	models: ConnectModel[]
): ConnectAvailabilityIssue | null {
	const anythingExists =
		vmodels.some((vm) => vm.enabled) || available.some((m) => m.type === 'backend-model');
	if (!anythingExists) return 'none';
	return models.length === 0 ? 'key_restricted' : null;
}

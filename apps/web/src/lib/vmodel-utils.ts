import type { VModel } from '$lib/api.js';

function hasModelSourceAccess(
	allowedModels: string[] | null,
	allowedBackends: string[] | null
): boolean {
	const vModelAccess = allowedModels == null || allowedModels.length > 0;
	const backendAccess = allowedBackends == null || allowedBackends.length > 0;
	return vModelAccess || backendAccess;
}

/** Whether a key form has at least one model source configured. */
export function validateKeyAccessSelection(
	restrictVModels: boolean,
	selectedVModelIds: string[],
	restrictBackends: boolean,
	selectedBackendIds: string[]
): string | null {
	const allowedModels = restrictVModels ? selectedVModelIds : null;
	const allowedBackends = restrictBackends ? selectedBackendIds : null;
	if (!hasModelSourceAccess(allowedModels, allowedBackends)) {
		return 'Select at least one allowed v-model or pass-through backend, or allow all in each section.';
	}
	return null;
}

/** Whether an allow-list entry refers to this v-model (alias or internal id). */
export function vModelMatchesAllowList(vm: VModel, allowedIds: string[]): boolean {
	return allowedIds.includes(vm.model_id) || allowedIds.includes(vm.id);
}

/** Rewrite stored allow-list entries to public aliases (migrates legacy internal ids). */
export function normalizeVModelAllowList(ids: string[], vmodels: VModel[]): string[] {
	return ids.map((id) => {
		const vm = vmodels.find((item) => item.id === id || item.model_id === id);
		return vm ? vm.model_id : id;
	});
}

/** V-models a key may use for Connect / inference (enabled, optional allow-list). */
export function eligibleVModelsForKey(
	vmodels: VModel[],
	allowedVModels?: string[] | null
): VModel[] {
	return vmodels.filter(
		(vm) =>
			vm.enabled && (!allowedVModels?.length || vModelMatchesAllowList(vm, allowedVModels))
	);
}

export type VModelAvailabilityIssue = 'none' | 'no_backends' | 'key_restricted';

export function getVModelAvailabilityIssue(
	vmodels: VModel[],
	allowedVModels?: string[] | null
): VModelAvailabilityIssue | null {
	const enabled = vmodels.filter((vm) => vm.enabled);
	if (enabled.length === 0) return 'none';

	const eligible = eligibleVModelsForKey(vmodels, allowedVModels);
	if (eligible.length === 0) return 'key_restricted';

	if (eligible.every((vm) => vm.backends.length === 0)) return 'no_backends';

	return null;
}

/** V-models ready to serve traffic (enabled, has backends, passes allow-list). */
export function connectableVModels(
	vmodels: VModel[],
	allowedVModels?: string[] | null
): VModel[] {
	return eligibleVModelsForKey(vmodels, allowedVModels).filter((vm) => vm.backends.length > 0);
}

export function allowedVModelsPayload(
	restrict: boolean,
	selectedIds: string[],
	mode: 'create' | 'update'
): string[] | null | undefined {
	if (!restrict) {
		return mode === 'update' ? null : undefined;
	}
	return selectedIds;
}

export function allowedBackendsPayload(
	restrict: boolean,
	selectedIds: string[],
	mode: 'create' | 'update'
): string[] | null | undefined {
	if (!restrict) {
		return mode === 'update' ? null : undefined;
	}
	return selectedIds;
}

import type { ApiKey, Backend, Plugin, PluginBinding, PluginScopeType, VModel } from './api.js';
import type { HoverListItem } from '$lib/components/HoverList.svelte';

export interface ScopeResources {
	vmodels: VModel[];
	backends: Backend[];
	keys: ApiKey[];
}

/** A v-model's display name, with its model ID appended when another v-model shares that name. */
export function vmodelLabel(vmodel: VModel, all: VModel[]): string {
	const shared = all.some((v) => v.id !== vmodel.id && v.display_name === vmodel.display_name);
	return shared ? `${vmodel.display_name} (${vmodel.model_id})` : vmodel.display_name;
}

/** Human-readable scope of a plugin binding, falling back to the raw ID for deleted resources. */
export function bindingScopeLabel(binding: PluginBinding, resources: ScopeResources): string {
	switch (binding.scopeType) {
		case 'global':
			return 'Global';
		case 'vmodel': {
			const vm = resources.vmodels.find((v) => v.id === binding.scopeId);
			return vm ? `V-Model: ${vmodelLabel(vm, resources.vmodels)}` : `V-Model: ${binding.scopeId ?? '—'}`;
		}
		case 'backend': {
			const b = resources.backends.find((b) => b.id === binding.scopeId);
			return b ? `Backend: ${b.name}` : `Backend: ${binding.scopeId ?? '—'}`;
		}
		case 'key': {
			const k = resources.keys.find((k) => k.id === binding.scopeId);
			return k ? `Key: ${k.name}` : `Key: ${binding.scopeId ?? '—'}`;
		}
		default:
			return binding.scopeType;
	}
}

/** Why a binding will not run, or null when it will. A disabled plugin never runs whatever its bindings say. */
export function bindingInactiveReason(pluginEnabled: boolean, bindingEnabled: boolean): string | null {
	if (!pluginEnabled) return 'plugin disabled';
	if (!bindingEnabled) return 'binding disabled';
	return null;
}

type PluginWithBindings = Plugin & { bindings: PluginBinding[] };

/** Hover-list rows for the plugins bound to one v-model, backend or key; inactive ones are dimmed with the reason. */
export function scopedPluginItems(
	plugins: PluginWithBindings[],
	scopeType: PluginScopeType,
	scopeId: string
): HoverListItem[] {
	return plugins.flatMap((plugin) =>
		plugin.bindings
			.filter((b) => b.scopeType === scopeType && b.scopeId === scopeId)
			.map((binding): HoverListItem => {
				const item: HoverListItem = { label: plugin.name };
				const reason = bindingInactiveReason(plugin.enabled, binding.enabled);
				if (reason) {
					item.inactive = true;
					item.note = reason;
				}
				return item;
			})
	);
}

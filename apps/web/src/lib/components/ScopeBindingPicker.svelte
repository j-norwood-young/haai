<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type {
		ConfigSchema,
		PluginBinding,
		PluginScopeType,
		Backend,
		VModel,
		ApiKey
	} from '$lib/api.js';
	import { bindingScopeLabel, vmodelLabel } from '$lib/plugin-bindings.js';
	import PluginConfigForm from './PluginConfigForm.svelte';

	interface Props {
		pluginId: string;
		configSchema: ConfigSchema | null;
		bindings: PluginBinding[];
	}

	let { pluginId, configSchema, bindings = $bindable([]) }: Props = $props();

	// Scope resources
	let backends = $state<Backend[]>([]);
	let vmodels = $state<VModel[]>([]);
	let keys = $state<ApiKey[]>([]);
	let resourcesLoaded = $state(false);

	// New binding form state
	let newScopeType = $state<PluginScopeType>('global');
	let newScopeId = $state<string>('');
	let newConfig = $state<Record<string, unknown>>({});
	let adding = $state(false);
	let addError = $state<string | null>(null);

	// A plugin binds to a given scope once, so only offer scopes it isn't bound to yet.
	const globalBound = $derived(bindings.some((b) => b.scopeType === 'global'));
	const boundIds = (type: PluginScopeType) =>
		new Set(bindings.filter((b) => b.scopeType === type).map((b) => b.scopeId));
	const freeVModels = $derived(vmodels.filter((v) => !boundIds('vmodel').has(v.id)));
	const freeBackends = $derived(backends.filter((b) => !boundIds('backend').has(b.id)));
	const freeKeys = $derived(keys.filter((k) => !boundIds('key').has(k.id)));

	// Delete confirm
	let deleteConfirm = $state<string | null>(null);

	onMount(async () => {
		const [b, v, k] = await Promise.all([
			api.getBackends().catch(() => [] as Backend[]),
			api.getVModels().catch(() => [] as VModel[]),
			api.getKeys().catch(() => [] as ApiKey[])
		]);
		backends = b;
		vmodels = v;
		keys = k;
		resourcesLoaded = true;
	});

	function scopeLabel(binding: PluginBinding): string {
		return bindingScopeLabel(binding, { vmodels, backends, keys });
	}

	function bindingConfig(config: PluginBinding['config']): Record<string, unknown> | null {
		if (!config) return null;
		if (typeof config === 'string') {
			try {
				return JSON.parse(config) as Record<string, unknown>;
			} catch {
				return null;
			}
		}
		return config;
	}

	function scopeDescription(binding: PluginBinding): string {
		switch (binding.scopeType) {
			case 'global':
				return 'Runs on every chat request, regardless of backend, model, or API key.';
			case 'vmodel':
				return 'Runs only when the client uses this virtual model.';
			case 'backend':
				return 'Runs only when traffic is routed to this backend.';
			case 'key':
				return 'Runs only for requests authenticated with this API key.';
			default:
				return '';
		}
	}

	function configSummary(binding: PluginBinding): string {
		const config = bindingConfig(binding.config);
		if (!config || Object.keys(config).length === 0) return 'Default config';
		return Object.entries(config)
			.slice(0, 4)
			.map(([k, v]) => `${k}: ${String(v)}`)
			.join(' · ');
	}

	async function toggleEnabled(binding: PluginBinding) {
		const next = !binding.enabled;
		try {
			await api.updateBinding(pluginId, binding.id, { enabled: next });
			bindings = bindings.map((b) => (b.id === binding.id ? { ...b, enabled: next } : b));
		} catch {
			// silently ignore – UI stays in sync
		}
	}

	async function handleDelete(bindingId: string) {
		try {
			await api.deleteBinding(pluginId, bindingId);
			bindings = bindings.filter((b) => b.id !== bindingId);
			deleteConfirm = null;
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to delete binding';
		}
	}

	async function handleAdd() {
		adding = true;
		addError = null;
		try {
			const scopeId = newScopeType === 'global' ? null : newScopeId || null;
			const config = Object.keys(newConfig).length > 0 ? newConfig : null;
			const created = await api.createBinding(pluginId, {
				scopeType: newScopeType,
				scopeId,
				config
			});
			bindings = [...bindings, created];
			newScopeType = 'global';
			newScopeId = '';
			newConfig = {};
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Failed to add binding';
		} finally {
			adding = false;
		}
	}

	const scopeOptions: { value: PluginScopeType; label: string }[] = [
		{ value: 'global', label: 'Global' },
		{ value: 'vmodel', label: 'V-Model' },
		{ value: 'backend', label: 'Backend' },
		{ value: 'key', label: 'Key' }
	];

	const hasConfigFields = $derived(configSchema && Object.keys(configSchema).length > 0);
</script>

<div class="space-y-4">
	<p class="text-sm text-(--color-text-muted)">
		Bindings decide <strong class="text-gray-300">when</strong> this plugin runs. Each row is one rule:
		pick a scope (global, v-model, backend, or key), optionally set config values, then enable or disable it.
	</p>

	<!-- Existing bindings -->
	{#if bindings.length > 0}
		<div class="rounded-xl border border-(--color-border) overflow-hidden">
			{#each bindings as binding, i (binding.id)}
				<div
					class="flex items-center gap-3 px-4 py-3 bg-(--color-surface-2)"
					class:border-t={i > 0}
					style="border-color: var(--color-border-subtle)"
				>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<p class="text-sm font-medium text-(--color-text)">{scopeLabel(binding)}</p>
							{#if binding.order > 0}
								<span class="badge badge-gray">order {binding.order}</span>
							{/if}
							<span class={binding.enabled ? 'badge badge-cyan' : 'badge badge-gray'}>
								{binding.enabled ? 'active' : 'inactive'}
							</span>
						</div>
						<p class="text-xs text-(--color-text-muted) mt-0.5">{scopeDescription(binding)}</p>
						<p class="text-xs text-gray-500 truncate mt-0.5 font-mono">{configSummary(binding)}</p>
					</div>

					<!-- Enabled toggle -->
					<button
						type="button"
						onclick={() => toggleEnabled(binding)}
						class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none"
						class:bg-cyan-500={binding.enabled}
						class:bg-gray-700={!binding.enabled}
						role="switch"
						aria-checked={binding.enabled}
						aria-label="Binding enabled"
					>
						<span
							class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
							class:translate-x-4={binding.enabled}
							class:translate-x-0={!binding.enabled}
						></span>
					</button>

					<!-- Delete -->
					{#if deleteConfirm === binding.id}
						<button
							onclick={() => handleDelete(binding.id)}
							class="btn btn-sm btn-danger-solid"
						>Confirm</button>
						<button
							onclick={() => (deleteConfirm = null)}
							class="btn btn-sm btn-secondary"
						>Cancel</button>
					{:else}
						<button
							onclick={() => (deleteConfirm = binding.id)}
							class="btn btn-sm btn-danger"
						>Delete</button>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-sm text-(--color-text-muted)">No bindings yet.</p>
	{/if}

	<!-- Add binding form -->
	<div class="rounded-xl border border-(--color-border) bg-(--color-surface-2) p-4 space-y-4">
		<h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Add Binding</h3>

		<!-- Scope type selector -->
		<div>
			<p class="text-xs font-medium text-gray-300 mb-2">Scope</p>
			<div class="flex rounded-lg overflow-hidden border border-(--color-border) text-xs w-fit">
				{#each scopeOptions as opt, i (opt.value)}
					<button
						type="button"
						onclick={() => { newScopeType = opt.value; newScopeId = ''; }}
						class="px-3 py-1.5 transition-colors"
						class:bg-gray-700={newScopeType === opt.value}
						class:text-white={newScopeType === opt.value}
						class:bg-transparent={newScopeType !== opt.value}
						class:text-gray-400={newScopeType !== opt.value}
						class:hover:text-gray-200={newScopeType !== opt.value}
						class:border-l={i > 0}
						style={i > 0 ? 'border-color: var(--color-border)' : ''}
					>{opt.label}</button>
				{/each}
			</div>
		</div>

		{#if newScopeType === 'global' && globalBound}
			<p class="text-xs text-gray-500">Already bound globally.</p>
		{/if}

		<!-- Scope ID picker (non-global) -->
		{#if newScopeType !== 'global'}
			<div>
				{#if !resourcesLoaded}
					<div class="input text-gray-500 text-sm">Loading…</div>
				{:else if newScopeType === 'vmodel'}
					<label for="new-scope-vmodel" class="block text-xs font-medium text-gray-300 mb-1">V-Model</label>
					<select id="new-scope-vmodel" class="input" bind:value={newScopeId}>
						<option value="">— select —</option>
						{#each freeVModels as v (v.id)}
							<option value={v.id}>{vmodelLabel(v, vmodels)}</option>
						{/each}
					</select>
					{#if freeVModels.length === 0}
						<p class="text-xs text-gray-500 mt-1">Already bound to all v-models.</p>
					{/if}
				{:else if newScopeType === 'backend'}
					<label for="new-scope-backend" class="block text-xs font-medium text-gray-300 mb-1">Backend</label>
					<select id="new-scope-backend" class="input" bind:value={newScopeId}>
						<option value="">— select —</option>
						{#each freeBackends as b (b.id)}
							<option value={b.id}>{b.name}</option>
						{/each}
					</select>
					{#if freeBackends.length === 0}
						<p class="text-xs text-gray-500 mt-1">Already bound to all backends.</p>
					{/if}
				{:else if newScopeType === 'key'}
					<label for="new-scope-key" class="block text-xs font-medium text-gray-300 mb-1">API Key</label>
					<select id="new-scope-key" class="input" bind:value={newScopeId}>
						<option value="">— select —</option>
						{#each freeKeys as k (k.id)}
							<option value={k.id}>{k.name}</option>
						{/each}
					</select>
					{#if freeKeys.length === 0}
						<p class="text-xs text-gray-500 mt-1">Already bound to all API keys.</p>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- Per-binding config -->
		{#if hasConfigFields}
			<div>
				<p class="text-xs font-medium text-gray-300 mb-2">Config</p>
				<PluginConfigForm {configSchema} bind:config={newConfig} />
			</div>
		{/if}

		{#if addError}
			<p class="text-sm text-red-400">{addError}</p>
		{/if}

		<button
			type="button"
			onclick={handleAdd}
			disabled={adding || (newScopeType === 'global' ? globalBound : !newScopeId)}
			class="btn btn-primary btn-md"
		>
			{adding ? 'Adding…' : 'Add Binding'}
		</button>
	</div>
</div>

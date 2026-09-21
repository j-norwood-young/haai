<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { Plugin, PluginBinding } from '$lib/api.js';
	import { bindingInactiveReason } from '$lib/plugin-bindings.js';
	import PluginConfigForm from '$lib/components/PluginConfigForm.svelte';

	/**
	 * Plugins bound to a single v-model, backend or API key. Lists what's bound, and lets the user
	 * add (with config) or remove plugins. Changes are saved immediately, independent of any form
	 * this sits in.
	 */
	interface Props {
		scopeType: 'vmodel' | 'backend' | 'key';
		scopeId: string;
		/** Singular noun used in copy, e.g. "v-model", "backend", "API key" */
		noun: string;
	}

	let { scopeType, scopeId, noun }: Props = $props();

	type PluginWithBindings = Plugin & { bindings: PluginBinding[] };

	let plugins = $state<PluginWithBindings[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let addPluginId = $state('');
	let addConfig = $state<Record<string, unknown>>({});
	let adding = $state(false);

	const inScope = (b: PluginBinding) => b.scopeType === scopeType && b.scopeId === scopeId;

	const bound = $derived(
		plugins.flatMap((plugin) => plugin.bindings.filter(inScope).map((binding) => ({ plugin, binding })))
	);
	const bindable = $derived(plugins.filter((p) => !p.bindings.some(inScope)));
	const selected = $derived(plugins.find((p) => p.id === addPluginId) ?? null);
	const selectedSchema = $derived(
		selected?.configSchema && Object.keys(selected.configSchema).length > 0 ? selected.configSchema : null
	);
	const missingRequiredConfig = $derived(
		Object.entries(selectedSchema ?? {}).some(([key, field]) => {
			const value = addConfig[key];
			return field.required && (value === undefined || value === null || value === '');
		})
	);

	onMount(async () => {
		try {
			plugins = await api.getPlugins();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load plugins';
		} finally {
			loading = false;
		}
	});

	async function handleAdd() {
		if (!selected || missingRequiredConfig) return;
		const plugin = selected;
		adding = true;
		error = null;
		try {
			const binding = await api.createBinding(plugin.id, {
				scopeType,
				scopeId,
				config: Object.keys(addConfig).length > 0 ? addConfig : null
			});
			plugins = plugins.map((p) => (p.id === plugin.id ? { ...p, bindings: [...p.bindings, binding] } : p));
			addPluginId = '';
			addConfig = {};
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to add plugin';
		} finally {
			adding = false;
		}
	}

	async function handleRemove(plugin: PluginWithBindings, binding: PluginBinding) {
		error = null;
		try {
			await api.deleteBinding(plugin.id, binding.id);
			plugins = plugins.map((p) =>
				p.id === plugin.id ? { ...p, bindings: p.bindings.filter((b) => b.id !== binding.id) } : p
			);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to remove plugin';
		}
	}

	// Enter in a plugin config field would otherwise submit an enclosing form.
	function handleConfigKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
	}
</script>

<div>
	<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Plugins</h2>
	<p class="text-xs text-gray-500 mb-3">
		Plugins here run only for requests to this {noun}. Changes are saved immediately. Plugins bound to
		other scopes, or to everything, are managed on the
		<a href="/plugins" class="text-cyan-400 hover:text-cyan-300">Plugins page</a>.
	</p>

	{#if loading}
		<p class="text-sm text-gray-500">Loading plugins…</p>
	{:else}
		{#if bound.length === 0}
			<p class="text-sm text-gray-500 mb-3">No plugins bound to this {noun}.</p>
		{:else}
			<div class="space-y-1.5 mb-4">
				{#each bound as { plugin, binding } (binding.id)}
					{@const inactiveReason = bindingInactiveReason(plugin.enabled, binding.enabled)}
					<div class="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
						<a
							href="/plugins/{plugin.id}"
							class="text-sm text-gray-200 hover:text-cyan-400 flex-1 min-w-0 truncate"
						>
							{plugin.name}
						</a>
						{#if inactiveReason}
							<span class="text-xs text-amber-400 bg-amber-900/30 rounded px-1.5 py-0.5">
								{inactiveReason}
							</span>
						{/if}
						<button
							type="button"
							onclick={() => handleRemove(plugin, binding)}
							class="text-xs text-gray-500 hover:text-red-400 transition-colors"
							aria-label="Remove plugin {plugin.name}"
						>
							Remove
						</button>
					</div>
				{/each}
			</div>
		{/if}

		{#if plugins.length === 0}
			<p class="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2">
				No plugins installed. <a href="/plugins/install" class="text-cyan-400 hover:text-cyan-300">Install a plugin</a> first.
			</p>
		{:else if bindable.length === 0}
			<p class="text-xs text-gray-500">All installed plugins are already added.</p>
		{:else}
			<div class="flex items-center gap-2">
				<select
					bind:value={addPluginId}
					onchange={() => (addConfig = {})}
					class="input flex-1 min-w-0 text-xs"
					aria-label="Plugin"
				>
					<option value="">Select plugin…</option>
					{#each bindable as p (p.id)}
						<option value={p.id}>{p.name}{p.enabled ? '' : ' (disabled)'}</option>
					{/each}
				</select>
				<button
					type="button"
					onclick={() => void handleAdd()}
					disabled={!selected || missingRequiredConfig || adding}
					class="px-3 py-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white rounded-md transition-colors shrink-0"
				>
					Add
				</button>
			</div>
			{#if selectedSchema}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="mt-3 rounded-lg border border-gray-800 bg-gray-800/30 p-3"
					onkeydown={handleConfigKeydown}
				>
					<p class="text-xs font-medium text-gray-300 mb-2">Config</p>
					{#key addPluginId}
						<PluginConfigForm configSchema={selectedSchema} bind:config={addConfig} />
					{/key}
				</div>
			{/if}
		{/if}
	{/if}

	{#if error}
		<p class="mt-3 text-sm text-red-400">{error}</p>
	{/if}
</div>

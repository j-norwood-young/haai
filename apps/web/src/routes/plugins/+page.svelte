<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { ApiKey, Backend, Plugin, PluginBinding, VModel } from '$lib/api.js';
	import { bindingInactiveReason, bindingScopeLabel } from '$lib/plugin-bindings.js';
	import HoverCount from '$lib/components/HoverCount.svelte';
	import type { HoverListItem } from '$lib/components/HoverList.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let plugins = $state<Array<Plugin & { bindings: PluginBinding[] }>>([]);
	let vmodels = $state<VModel[]>([]);
	let backends = $state<Backend[]>([]);
	let keys = $state<ApiKey[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let deleteConfirm = $state<string | null>(null);
	let togglingId = $state<string | null>(null);

	function bindingItems(plugin: Plugin & { bindings: PluginBinding[] }): HoverListItem[] {
		return plugin.bindings.map((binding) => {
			const item: HoverListItem = { label: bindingScopeLabel(binding, { vmodels, backends, keys }) };
			const reason = bindingInactiveReason(plugin.enabled, binding.enabled);
			if (reason) {
				item.inactive = true;
				item.note = reason;
			}
			return item;
		});
	}

	async function load() {
		try {
			// Scope names are a nicety: if a lookup fails the binding falls back to showing its raw ID
			const [list, vm, be, ke] = await Promise.all([
				api.getPlugins(),
				api.getVModels().catch(() => [] as VModel[]),
				api.getBackends().catch(() => [] as Backend[]),
				api.getKeys().catch(() => [] as ApiKey[])
			]);
			plugins = list;
			vmodels = vm;
			backends = be;
			keys = ke;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load plugins';
		} finally {
			loading = false;
		}
	}

	async function toggleEnabled(plugin: Plugin) {
		togglingId = plugin.id;
		try {
			await api.updatePlugin(plugin.id, { enabled: !plugin.enabled });
			plugins = plugins.map((p) => (p.id === plugin.id ? { ...p, enabled: !p.enabled } : p));
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to update plugin';
		} finally {
			togglingId = null;
		}
	}

	async function handleDelete(id: string) {
		try {
			await api.deletePlugin(id);
			plugins = plugins.filter((p) => p.id !== id);
			deleteConfirm = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete plugin';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Plugins — HAAI</title>
</svelte:head>

<div class="page">
	<PageHeader title="Plugins" subtitle="Sandboxed request/response transformers">
		{#snippet actions()}
			<a href="/plugins/install" class="btn btn-primary btn-md">+ Install Plugin</a>
		{/snippet}
	</PageHeader>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm mb-4">
			{error}
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if plugins.length === 0}
		<div class="text-center py-16 text-gray-500">
			<p class="text-lg mb-2">No plugins installed</p>
			<p class="text-sm mb-4">Install a plugin to start transforming requests and responses.</p>
			<a href="/plugins/install" class="text-cyan-400 hover:text-cyan-300 text-sm">Install Plugin →</a>
		</div>
	{:else}
		<div class="table-container">
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th class="hidden sm:table-cell">Version</th>
						<th class="hidden md:table-cell">Hooks</th>
						<th class="hidden md:table-cell">Bindings</th>
						<th>Enabled</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each plugins as plugin (plugin.id)}
						<tr>
							<td>
								<div>
									<p class="font-medium text-(--color-text)">{plugin.name}</p>
									{#if plugin.description}
										<p class="text-xs text-(--color-text-muted) mt-0.5 truncate max-w-60">
											{plugin.description}
										</p>
									{/if}
								</div>
							</td>
							<td class="text-(--color-text-muted) font-mono text-xs hidden sm:table-cell">
								{plugin.version ?? '—'}
							</td>
							<td class="hidden md:table-cell">
								<div class="flex flex-wrap gap-1">
									{#each plugin.manifest.hooks as hook (hook)}
										<span class="badge badge-cyan">{hook}</span>
									{/each}
								</div>
							</td>
							<td class="text-gray-400 hidden md:table-cell">
								<HoverCount heading="Bindings" items={bindingItems(plugin)} />
							</td>
							<td>
								<button
									type="button"
									onclick={() => toggleEnabled(plugin)}
									disabled={togglingId === plugin.id}
									class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50"
									class:bg-cyan-500={plugin.enabled}
									class:bg-gray-700={!plugin.enabled}
									role="switch"
									aria-checked={plugin.enabled}
									aria-label="Plugin enabled"
								>
									<span
										class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
										class:translate-x-4={plugin.enabled}
										class:translate-x-0={!plugin.enabled}
									></span>
								</button>
							</td>
							<td class="text-right">
								<div class="flex items-center justify-end gap-2">
									<a href="/plugins/{plugin.id}" class="btn btn-sm btn-secondary">Edit</a>
									{#if deleteConfirm === plugin.id}
										<button
											onclick={() => handleDelete(plugin.id)}
											class="btn btn-sm btn-danger-solid"
										>Confirm</button>
										<button
											onclick={() => (deleteConfirm = null)}
											class="btn btn-sm btn-secondary"
										>Cancel</button>
									{:else}
										<button
											onclick={() => (deleteConfirm = plugin.id)}
											class="btn btn-sm btn-danger"
										>Delete</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

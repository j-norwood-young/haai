<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { Plugin } from '$lib/api.js';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let plugins = $state<Plugin[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let deleteConfirm = $state<string | null>(null);
	let togglingId = $state<string | null>(null);

	async function load() {
		try {
			plugins = await api.getPlugins();
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
						<th class="hidden lg:table-cell">Bindings</th>
						<th>Enabled</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each plugins as plugin (plugin.id)}
						<tr>
							<td>
								<div>
									<p class="font-medium text-[var(--color-text)]">{plugin.name}</p>
									{#if plugin.description}
										<p class="text-xs text-[var(--color-text-muted)] mt-0.5 truncate max-w-[240px]">
											{plugin.description}
										</p>
									{/if}
								</div>
							</td>
							<td class="text-[var(--color-text-muted)] font-mono text-xs hidden sm:table-cell">
								{plugin.version ?? '—'}
							</td>
							<td class="hidden md:table-cell">
								<div class="flex flex-wrap gap-1">
									{#each plugin.manifest.hooks as hook (hook)}
										<span class="badge badge-cyan">{hook}</span>
									{/each}
								</div>
							</td>
							<td class="text-[var(--color-text-muted)] hidden lg:table-cell">
								—
							</td>
							<td>
								<button
									type="button"
									onclick={() => toggleEnabled(plugin)}
									disabled={togglingId === plugin.id}
									class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50"
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
									<a href="/plugins/{plugin.id}" class="btn btn-sm btn-secondary">Detail</a>
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

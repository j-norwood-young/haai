<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api.js';
	import type { Plugin, PluginBinding } from '$lib/api.js';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ScopeBindingPicker from '$lib/components/ScopeBindingPicker.svelte';

	const id = $derived(page.params.id!);

	let plugin = $state<(Plugin & { bindings: PluginBinding[] }) | null>(null);
	let bindings = $state<PluginBinding[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let enablingToggle = $state(false);
	let reinstalling = $state(false);
	let deleteConfirm = $state(false);
	let actionError = $state<string | null>(null);

	async function load() {
		loading = true;
		error = null;
		try {
			const data = await api.getPlugin(id);
			plugin = data;
			bindings = data.bindings;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load plugin';
		} finally {
			loading = false;
		}
	}

	async function toggleEnabled() {
		if (!plugin) return;
		enablingToggle = true;
		actionError = null;
		try {
			await api.updatePlugin(plugin.id, { enabled: !plugin.enabled });
			plugin = { ...plugin, enabled: !plugin.enabled };
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to update plugin';
		} finally {
			enablingToggle = false;
		}
	}

	async function handleReinstall() {
		if (!plugin) return;
		reinstalling = true;
		actionError = null;
		try {
			await api.reinstallPlugin(plugin.id);
			await load();
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Reinstall failed';
		} finally {
			reinstalling = false;
		}
	}

	async function handleDelete() {
		if (!plugin) return;
		try {
			await api.deletePlugin(plugin.id);
			goto('/plugins');
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to delete plugin';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>{plugin?.name ?? 'Plugin'} — HAAI</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto space-y-4">
	<PageHeader
		title={plugin?.name ?? 'Plugin'}
		parentHref="/plugins"
		parentLabel="Plugins"
	/>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm">
			{error}
		</div>
	{:else if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if plugin}
		<!-- Info card -->
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Plugin Info</h2>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
				<div>
					<p class="text-xs text-[var(--color-text-muted)] mb-0.5">Name</p>
					<p class="text-[var(--color-text)] font-medium">{plugin.name}</p>
				</div>
				<div>
					<p class="text-xs text-[var(--color-text-muted)] mb-0.5">Version</p>
					<p class="text-[var(--color-text)] font-mono">{plugin.version ?? '—'}</p>
				</div>
				<div class="sm:col-span-2">
					<p class="text-xs text-[var(--color-text-muted)] mb-0.5">Description</p>
					<p class="text-[var(--color-text)]">{plugin.description ?? '—'}</p>
				</div>
				<div class="sm:col-span-2">
					<p class="text-xs text-[var(--color-text-muted)] mb-0.5">Source</p>
					<p class="text-[var(--color-text)] font-mono text-xs break-all">{plugin.source}</p>
				</div>
				<div>
					<p class="text-xs text-[var(--color-text-muted)] mb-0.5">Hooks</p>
					<div class="flex flex-wrap gap-1 mt-1">
						{#each plugin.manifest.hooks as hook (hook)}
							<span class="badge badge-cyan">{hook}</span>
						{/each}
					</div>
				</div>
				<div>
					<p class="text-xs text-[var(--color-text-muted)] mb-0.5">Needs response buffer</p>
					<span class={plugin.needsResponseBuffer ? 'badge badge-yellow' : 'badge badge-gray'}>
						{plugin.needsResponseBuffer ? 'Yes' : 'No'}
					</span>
				</div>
			</div>

			<!-- Enabled toggle -->
			<div class="flex items-start gap-3 pt-2 border-t border-gray-800">
				<button
					type="button"
					onclick={toggleEnabled}
					disabled={enablingToggle}
					class="mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50"
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
				<div>
					<p class="text-sm font-medium text-gray-200">Plugin enabled</p>
					<p class="text-xs text-gray-500 mt-0.5">
						{plugin.enabled
							? 'This plugin will run on matching requests.'
							: 'This plugin is disabled and will not run.'}
					</p>
				</div>
			</div>
		</div>

		<!-- Config schema -->
		{#if plugin.configSchema && Object.keys(plugin.configSchema).length > 0}
			<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
				<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Config Schema</h2>
				<div class="space-y-2">
					{#each Object.entries(plugin.configSchema) as [key, field] (key)}
						<div class="flex items-start gap-3 text-sm">
							<code class="text-cyan-400 font-mono text-xs w-32 shrink-0 pt-0.5">{key}</code>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="badge badge-gray">{field.type}</span>
									{#if field.required}
										<span class="badge badge-red">required</span>
									{/if}
									<span class="text-[var(--color-text)]">{field.label}</span>
								</div>
								{#if field.description}
									<p class="text-xs text-[var(--color-text-muted)] mt-0.5">{field.description}</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Bindings -->
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Bindings</h2>
			<ScopeBindingPicker
				pluginId={plugin.id}
				configSchema={plugin.configSchema}
				bind:bindings
			/>
		</div>

		<!-- Danger zone -->
		<div class="bg-gray-900 border border-red-900/40 rounded-xl p-5 space-y-4">
			<h2 class="text-xs font-semibold text-red-400 uppercase tracking-wider">Danger Zone</h2>

			{#if actionError}
				<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm">
					{actionError}
				</div>
			{/if}

			<div class="flex flex-wrap gap-3 items-start">
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium text-gray-200">Reinstall plugin</p>
					<p class="text-xs text-gray-500 mt-0.5">
						Re-fetches the plugin bundle from the original source. Existing bindings are preserved.
					</p>
				</div>
				<button
					onclick={handleReinstall}
					disabled={reinstalling}
					class="btn btn-secondary btn-md shrink-0"
				>
					{reinstalling ? 'Reinstalling…' : 'Reinstall'}
				</button>
			</div>

			<div class="border-t border-gray-800 pt-4 flex flex-wrap gap-3 items-start">
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium text-gray-200">Delete plugin</p>
					<p class="text-xs text-gray-500 mt-0.5">
						Permanently removes this plugin and all its bindings. This action cannot be undone.
					</p>
				</div>
				{#if deleteConfirm}
					<button onclick={handleDelete} class="btn btn-danger-solid btn-md shrink-0">
						Confirm Delete
					</button>
					<button onclick={() => (deleteConfirm = false)} class="btn btn-secondary btn-md shrink-0">
						Cancel
					</button>
				{:else}
					<button
						onclick={() => (deleteConfirm = true)}
						class="btn btn-danger btn-md shrink-0"
					>
						Delete Plugin
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { Hook } from '$lib/api.js';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let hooks = $state<Hook[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let testResults = $state<Record<string, { success: boolean; error?: string; loading: boolean }>>({});
	let deleteConfirm = $state<string | null>(null);

	async function load() {
		try {
			hooks = await api.getHooks();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load hooks';
		} finally {
			loading = false;
		}
	}

	async function testHook(id: string) {
		testResults = { ...testResults, [id]: { success: false, loading: true } };
		try {
			const result = await api.testHook(id);
			testResults = { ...testResults, [id]: { ...result, loading: false } };
		} catch (err) {
			testResults = {
				...testResults,
				[id]: { success: false, error: err instanceof Error ? err.message : 'Test failed', loading: false }
			};
		}
	}

	async function handleDelete(id: string) {
		try {
			await api.deleteHook(id);
			hooks = hooks.filter((h) => h.id !== id);
			deleteConfirm = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete hook';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Hooks — AiVM</title>
</svelte:head>

<div class="page">
	<PageHeader title="Hooks" subtitle="Event-driven webhooks and internal handlers">
		{#snippet actions()}
			<a href="/hooks/new?type=webhook" class="btn btn-primary btn-md">
				+ Add Webhook
			</a>
			<a href="/hooks/new?type=internal" class="btn btn-secondary btn-md">
				+ Add Internal
			</a>
		{/snippet}
	</PageHeader>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm mb-4">{error}</div>
	{/if}

	{#if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if hooks.length === 0}
		<div class="text-center py-16 text-gray-500">
			<p class="text-lg mb-2">No hooks configured</p>
			<p class="text-sm mb-4">Add webhooks or internal handlers to react to events.</p>
			<div class="flex justify-center gap-4 text-sm">
				<a href="/hooks/new?type=webhook" class="text-cyan-400 hover:text-cyan-300">Add Webhook →</a>
				<a href="/hooks/new?type=internal" class="text-cyan-400 hover:text-cyan-300">Add Internal →</a>
			</div>
		</div>
	{:else}
		<div class="table-container">
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Type</th>
						<th>Trigger</th>
						<th class="hidden md:table-cell">Target</th>
						<th>Enabled</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each hooks as hook (hook.id)}
						<tr>
							<td class="text-[var(--color-text)] font-medium">{hook.name}</td>
							<td>
								<span class="{hook.type === 'webhook' ? 'badge badge-cyan' : 'badge badge-gray'}">
									{hook.type}
								</span>
							</td>
							<td class="text-[var(--color-text-muted)] font-mono text-xs">{hook.trigger}</td>
							<td class="text-[var(--color-text-muted)] text-xs truncate max-w-[200px] hidden md:table-cell">
								{hook.url ?? hook.module ?? '—'}
							</td>
							<td>
								<span class="{hook.enabled ? 'badge badge-green' : 'badge badge-gray'}">
									{hook.enabled ? 'Enabled' : 'Disabled'}
								</span>
							</td>
							<td class="text-right">
								<div class="flex items-center justify-end gap-2">
									{#if testResults[hook.id]?.loading}
										<span class="text-xs text-gray-500">Testing…</span>
									{:else if testResults[hook.id]}
										{@const r = testResults[hook.id]!}
										{#if r.success}
											<span class="text-xs text-green-400">✓ OK</span>
										{:else}
											<span class="text-xs text-red-400" title={r.error}>✗ Failed</span>
										{/if}
									{/if}
									<button onclick={() => testHook(hook.id)} class="btn btn-sm btn-secondary">
										Test
									</button>
									<a href="/hooks/{hook.id}/edit" class="btn btn-sm btn-secondary">
										Edit
									</a>
									{#if deleteConfirm === hook.id}
										<button onclick={() => handleDelete(hook.id)} class="btn btn-sm btn-danger-solid">Confirm</button>
										<button onclick={() => (deleteConfirm = null)} class="btn btn-sm btn-secondary">Cancel</button>
									{:else}
										<button onclick={() => (deleteConfirm = hook.id)} class="btn btn-sm btn-danger">Delete</button>
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

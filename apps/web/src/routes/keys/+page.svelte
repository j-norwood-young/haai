<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { ApiKey } from '$lib/api.js';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SecretReveal from '$lib/components/SecretReveal.svelte';
	import KeyConnect from '$lib/components/KeyConnect.svelte';

	let keys = $state<ApiKey[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let deleteConfirm = $state<string | null>(null);

	async function load() {
		try {
			keys = await api.getKeys();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load keys';
		} finally {
			loading = false;
		}
	}

	async function handleDelete(id: string) {
		try {
			await api.deleteKey(id);
			keys = keys.filter((k) => k.id !== id);
			deleteConfirm = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete key';
		}
	}

	function formatDate(ts?: string): string {
		if (!ts) return '—';
		return new Date(ts).toLocaleDateString();
	}

	onMount(load);
</script>

<svelte:head>
	<title>API Keys — HAAI</title>
</svelte:head>

<div class="page">
	<PageHeader title="API Keys" subtitle="Manage access keys and rate limits">
		{#snippet actions()}
			<a href="/keys/new" class="btn btn-primary btn-md">
				+ Create Key
			</a>
		{/snippet}
	</PageHeader>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm mb-4">
			{error}
		</div>
	{/if}

	{#if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if keys.length === 0}
		<div class="text-center py-16 text-gray-500">
			<p class="text-lg mb-2">No API keys</p>
			<p class="text-sm mb-4">Create your first key to grant access.</p>
			<a href="/keys/new" class="text-cyan-400 hover:text-cyan-300 text-sm">Create Key →</a>
		</div>
	{:else}
		<div class="table-container">
			<table>
				<thead>
					<tr>
						<th>Prefix</th>
						<th>Key</th>
						<th>Name</th>
						<th>Status</th>
						<th class="hidden md:table-cell">RPM</th>
						<th class="hidden md:table-cell">Day Budget</th>
						<th class="hidden lg:table-cell">Last Used</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each keys as key (key.id)}
						<tr>
							<td class="font-mono text-cyan-400 text-xs">{key.key_prefix}…</td>
							<td class="max-w-xs">
								<div class="flex items-center gap-2 flex-wrap">
									<SecretReveal
										retrievable={key.retrievable}
										fetchSecret={() => api.revealKey(key.id)}
										unavailableLabel="Not available"
									/>
									<KeyConnect
										keyPrefix={key.key_prefix}
										retrievable={key.retrievable}
										allowedVModels={key.allowed_vmodels}
										fetchSecret={() => api.revealKey(key.id)}
									/>
								</div>
							</td>
							<td class="text-[var(--color-text)]">{key.name}</td>
							<td>
								{#if key.suspended}
									<span class="badge badge-yellow">Suspended</span>
								{:else if key.enabled}
									<span class="badge badge-green">Active</span>
								{:else}
									<span class="badge badge-gray">Disabled</span>
								{/if}
							</td>
							<td class="text-[var(--color-text-muted)] hidden md:table-cell">
								{key.rpm_limit != null ? key.rpm_limit : '—'}
							</td>
							<td class="text-[var(--color-text-muted)] hidden md:table-cell">
								{key.day_budget != null ? `$${key.day_budget}` : '—'}
							</td>
							<td class="text-[var(--color-text-muted)] hidden lg:table-cell">{formatDate(key.last_used_at)}</td>
							<td class="text-right">
								<div class="flex items-center justify-end gap-2 flex-wrap">
									<a href="/keys/{key.id}/logs" class="btn btn-sm btn-secondary">
										Logs
									</a>
									<a href="/keys/{key.id}/edit" class="btn btn-sm btn-secondary">
										Edit
									</a>
									{#if deleteConfirm === key.id}
										<button
											onclick={() => handleDelete(key.id)}
											class="btn btn-sm btn-danger-solid"
										>
											Confirm
										</button>
										<button
											onclick={() => (deleteConfirm = null)}
											class="btn btn-sm btn-secondary"
										>
											Cancel
										</button>
									{:else}
										<button
											onclick={() => (deleteConfirm = key.id)}
											class="btn btn-sm btn-danger"
										>
											Delete
										</button>
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

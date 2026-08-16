<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { Backend } from '$lib/api.js';
	import { sse } from '$lib/sse.svelte.js';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import BackendHealthDetailsModal from '$lib/components/BackendHealthDetailsModal.svelte';
	import BackendModelsModal from '$lib/components/BackendModelsModal.svelte';
	import {
		hasHealthDetails,
		healthBadgeClass,
		type BackendHealthDetails
	} from '$lib/backend-health.js';
	import { backendHealthState } from '$lib/backend-health-state.svelte.js';

	type TestResult = {
		success: boolean;
		loading: boolean;
		latency_ms?: number;
		error?: string;
	};

	let backends = $state<Backend[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let testResults = $state<Record<string, TestResult>>({});
	let deleteConfirm = $state<string | null>(null);
	let healthDetails = $state<BackendHealthDetails | null>(null);
	let modelsBackend = $state<Backend | null>(null);
	// Non-reactive guard so writing it does not re-enter the SSE $effect
	let lastHandledHealthAt: number | null = null;

	async function load() {
		try {
			backends = await api.getBackends();
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load backends';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const event = sse.latestEvent;
		if (event?.type !== 'backend-health') return;
		const ts = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
		if (lastHandledHealthAt === ts) return;
		lastHandledHealthAt = ts;
		void load();
	});

	function openHealthDetails(backend: Backend) {
		if (!hasHealthDetails(backend.health)) return;
		const details: BackendHealthDetails = {
			id: backend.id,
			name: backend.name,
			health: backend.health,
			url: backend.url
		};
		if (backend.latency_ms != null) details.latency_ms = backend.latency_ms;
		if (backend.health_error) details.error = backend.health_error;
		if (backend.checked_at) details.checked_at = backend.checked_at;
		healthDetails = details;
	}

	function closeHealthDetails() {
		healthDetails = null;
	}

	function openModels(backend: Backend) {
		modelsBackend = backend;
	}

	function closeModels() {
		modelsBackend = null;
	}

	function onHealthUpdated(result: {
		id: string;
		health: 'healthy' | 'degraded' | 'unhealthy';
		latency_ms?: number;
		error?: string;
	}) {
		backends = backends.map((b) => {
			if (b.id !== result.id) return b;
			const updated: Backend = { ...b, health: result.health };
			if (result.latency_ms !== undefined) updated.latency_ms = result.latency_ms;
			else delete updated.latency_ms;
			if (result.error) updated.health_error = result.error;
			else delete updated.health_error;
			updated.checked_at = new Date().toISOString();
			return updated;
		});
		void backendHealthState.refresh();

		if (healthDetails?.id === result.id) {
			if (!hasHealthDetails(result.health)) {
				healthDetails = null;
				return;
			}
			const details: BackendHealthDetails = {
				id: result.id,
				name: healthDetails.name,
				health: result.health,
				checked_at: new Date().toISOString()
			};
			if (healthDetails.url) details.url = healthDetails.url;
			if (result.latency_ms !== undefined) details.latency_ms = result.latency_ms;
			if (result.error) details.error = result.error;
			healthDetails = details;
		}
	}

	async function testBackend(id: string) {
		testResults = { ...testResults, [id]: { success: false, loading: true } };
		try {
			const result = await api.testBackend(id);
			const next: TestResult = { success: result.success, loading: false };
			if (result.latency_ms !== undefined) next.latency_ms = result.latency_ms;
			if (result.error !== undefined) next.error = result.error;
			testResults = { ...testResults, [id]: next };
			if (result.health) {
				backends = backends.map((b) => {
					if (b.id !== id) return b;
					const updated: Backend = { ...b, health: result.health! };
					const latency = result.latency_ms ?? b.latency_ms;
					if (latency !== undefined) updated.latency_ms = latency;
					if (result.error) updated.health_error = result.error;
					else delete updated.health_error;
					updated.checked_at = new Date().toISOString();
					return updated;
				});
			}
		} catch (err) {
			testResults = {
				...testResults,
				[id]: {
					success: false,
					loading: false,
					error: err instanceof Error ? err.message : 'Test failed'
				}
			};
		}
	}

	async function handleDelete(id: string) {
		try {
			await api.deleteBackend(id);
			backends = backends.filter((b) => b.id !== id);
			deleteConfirm = null;
			void backendHealthState.refresh();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete backend';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Backends — AiVM</title>
</svelte:head>

<div class="page">
	<PageHeader title="Backends" subtitle="Manage LLM backend connections">
		{#snippet actions()}
			<a href="/backends/new" class="btn btn-primary btn-md">
				+ Add Backend
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
	{:else if backends.length === 0}
		<div class="text-center py-16 text-gray-500">
			<p class="text-lg mb-2">No backends configured</p>
			<p class="text-sm mb-4">Add your first backend to get started.</p>
			<a href="/backends/new" class="text-cyan-400 hover:text-cyan-300 text-sm">Add Backend →</a>
		</div>
	{:else}
		<div class="table-container">
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Provider</th>
						<th class="hidden md:table-cell">URL</th>
						<th>Health</th>
						<th class="hidden lg:table-cell">Latency</th>
						<th>Enabled</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each backends as backend (backend.id)}
						<tr>
							<td class="font-medium text-[var(--color-text)]">{backend.name}</td>
							<td class="text-[var(--color-text-muted)] capitalize">{backend.provider}</td>
							<td class="text-[var(--color-text-muted)] hidden md:table-cell font-mono text-xs truncate max-w-[200px]">{backend.url}</td>
							<td>
								{#if hasHealthDetails(backend.health)}
									<button
										type="button"
										class="capitalize {healthBadgeClass(backend.health)} cursor-pointer hover:opacity-90"
										onclick={() => openHealthDetails(backend)}
										title="View health details"
									>
										{backend.health}
									</button>
								{:else}
									<span class="capitalize {healthBadgeClass(backend.health)}">
										{backend.health}
									</span>
								{/if}
							</td>
							<td class="text-[var(--color-text-muted)] hidden lg:table-cell">
								{backend.latency_ms != null ? `${backend.latency_ms}ms` : '—'}
							</td>
							<td>
								<span class="{backend.enabled ? 'badge badge-green' : 'badge badge-gray'}">
									{backend.enabled ? 'Yes' : 'No'}
								</span>
							</td>
							<td class="text-right">
								<div class="flex items-center justify-end gap-2">
									{#if testResults[backend.id]?.loading}
										<span class="text-xs text-gray-500">Testing…</span>
									{:else if testResults[backend.id]}
										{@const r = testResults[backend.id]!}
										{#if r.success}
											<span class="text-xs text-green-400">{r.latency_ms}ms ✓</span>
										{:else}
											<span class="text-xs text-red-400" title={r.error}>✗ Failed</span>
										{/if}
									{/if}
									<button
										onclick={() => openModels(backend)}
										class="btn btn-sm btn-secondary"
									>
										Models
									</button>
									<button
										onclick={() => testBackend(backend.id)}
										class="btn btn-sm btn-secondary"
									>
										Test
									</button>
									<a
										href="/backends/{backend.id}/edit"
										class="btn btn-sm btn-secondary"
									>
										Edit
									</a>
									{#if deleteConfirm === backend.id}
										<button
											onclick={() => handleDelete(backend.id)}
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
											onclick={() => (deleteConfirm = backend.id)}
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

<BackendHealthDetailsModal
	open={healthDetails != null}
	backend={healthDetails}
	onclose={closeHealthDetails}
	onupdated={onHealthUpdated}
/>

<BackendModelsModal
	open={modelsBackend != null}
	backend={modelsBackend}
	onclose={closeModels}
/>

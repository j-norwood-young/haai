<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import { sse } from '$lib/sse.svelte.js';
	import type { ApiKey, Backend, MetricsSummary, MetricsRollup, VModel } from '$lib/api.js';

	let summary = $state.raw<MetricsSummary | null>(null);
	let rollups = $state.raw<MetricsRollup[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let period = $state<'hour' | 'day' | 'week' | 'month'>('hour');

	let backends = $state.raw<Backend[]>([]);
	let vmodels = $state.raw<VModel[]>([]);
	let keys = $state.raw<ApiKey[]>([]);

	let filterBackendId = $state('');
	let filterVmodelId = $state('');
	let filterModelId = $state('');
	let filterKeyId = $state('');

	// Non-reactive guards — must not be $state or effects re-enter
	let loadSeq = 0;
	let lastHandledAt: number | null = null;

	const hasFilters = $derived(
		Boolean(filterBackendId || filterVmodelId || filterModelId || filterKeyId)
	);

	const modelOptions = $derived(
		[
			...new Set(
				vmodels.flatMap((v) => v.backends.map((b) => b.backend_model_id).filter(Boolean))
			)
		].sort((a, b) => a.localeCompare(b))
	);

	async function loadFilterOptions() {
		try {
			const [nextBackends, nextVmodels, nextKeys] = await Promise.all([
				api.getBackends(),
				api.getVModels(),
				api.getKeys()
			]);
			backends = nextBackends;
			vmodels = nextVmodels;
			keys = nextKeys;
		} catch {
			// Dropdowns stay empty; metrics still load
		}
	}

	async function load() {
		const my = ++loadSeq;
		error = null;
		try {
			const windowMs =
				period === 'hour'
					? 48 * 3600 * 1000
					: period === 'day'
						? 48 * 86400 * 1000
						: period === 'week'
							? 48 * 7 * 86400 * 1000
							: 48 * 30 * 86400 * 1000;
			const since = new Date(Date.now() - windowMs).toISOString();
			const filters = {
				...(filterBackendId ? { backendId: filterBackendId } : {}),
				...(filterVmodelId ? { vmodelId: filterVmodelId } : {}),
				...(filterModelId ? { backendModelId: filterModelId } : {}),
				...(filterKeyId ? { keyId: filterKeyId } : {})
			};
			const [nextSummary, nextRollups] = await Promise.all([
				api.getMetricsSummary(filters),
				api.getMetricsRollups({ period, limit: 48, since, ...filters })
			]);
			if (my !== loadSeq) return;
			summary = nextSummary;
			rollups = nextRollups;
		} catch (err) {
			if (my !== loadSeq) return;
			error = err instanceof Error ? err.message : 'Failed to load metrics';
		} finally {
			if (my === loadSeq) loading = false;
		}
	}

	function clearFilters() {
		filterBackendId = '';
		filterVmodelId = '';
		filterModelId = '';
		filterKeyId = '';
	}

	onMount(() => {
		void loadFilterOptions();
	});

	$effect(() => {
		void period;
		void filterBackendId;
		void filterVmodelId;
		void filterModelId;
		void filterKeyId;
		void load();
	});

	$effect(() => {
		const event = sse.latestEvent;
		if (event?.type !== 'usage-event' && event?.type !== 'backend-health') return;
		const ts = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
		if (lastHandledAt === ts) return;
		lastHandledAt = ts;
		void load();
	});

	const maxRequests = $derived(
		rollups.length > 0 ? Math.max(...rollups.map((r) => r.requests), 1) : 1
	);
	const maxTokens = $derived(
		rollups.length > 0 ? Math.max(...rollups.map((r) => r.tokens), 1) : 1
	);

	function formatNum(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return String(n);
	}

	function formatPct(n: number): string {
		return `${(n * 100).toFixed(2)}%`;
	}

	function formatTime(ts: string): string {
		const d = new Date(ts);
		if (period === 'hour') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		if (period === 'day') return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
		return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

</script>

<svelte:head>
	<title>Metrics — HAAI</title>
</svelte:head>

<div class="page">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-[var(--color-text)]">Metrics</h1>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">Usage statistics and performance data</p>
		</div>
		<div class="flex items-center gap-2">
			{#each (['hour', 'day', 'week', 'month'] as const) as p (p)}
				<button
					onclick={() => (period = p)}
					class="{period === p ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} capitalize"
				>
					{p}
				</button>
			{/each}
		</div>
	</div>

	<div class="flex flex-wrap items-end gap-3 mb-6">
		<div class="min-w-[140px] flex-1">
			<label for="filter-backend" class="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Backend</label>
			<select id="filter-backend" class="input" bind:value={filterBackendId}>
				<option value="">All</option>
				{#each backends as b (b.id)}
					<option value={b.id}>{b.name}</option>
				{/each}
			</select>
		</div>
		<div class="min-w-[140px] flex-1">
			<label for="filter-vmodel" class="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Virtual model</label>
			<select id="filter-vmodel" class="input" bind:value={filterVmodelId}>
				<option value="">All</option>
				{#each vmodels as v (v.id)}
					<option value={v.id}>{v.display_name || v.model_id}</option>
				{/each}
			</select>
		</div>
		<div class="min-w-[140px] flex-1">
			<label for="filter-model" class="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Model</label>
			<select id="filter-model" class="input" bind:value={filterModelId}>
				<option value="">All</option>
				{#each modelOptions as mid (mid)}
					<option value={mid}>{mid}</option>
				{/each}
			</select>
		</div>
		<div class="min-w-[140px] flex-1">
			<label for="filter-key" class="block text-xs font-medium text-[var(--color-text-muted)] mb-1">API key</label>
			<select id="filter-key" class="input" bind:value={filterKeyId}>
				<option value="">All</option>
				{#each keys as k (k.id)}
					<option value={k.id}>{k.name} ({k.key_prefix}…)</option>
				{/each}
			</select>
		</div>
		{#if hasFilters}
			<button
				type="button"
				class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors pb-2"
				onclick={clearFilters}
			>
				Clear filters
			</button>
		{/if}
	</div>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm mb-4">{error}</div>
	{/if}

	{#if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if summary}
		<!-- Summary Cards -->
		<div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
			<div class="card p-4">
				<p class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Requests</p>
				<p class="text-2xl font-bold text-[var(--color-text)]">{formatNum(summary.total_requests_24h)}</p>
				<p class="text-xs text-[var(--color-text-subtle)] mt-1">24 hours</p>
			</div>
			<div class="card p-4">
				<p class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Tokens</p>
				<p class="text-2xl font-bold text-[var(--color-text)]">{formatNum(summary.total_tokens_24h)}</p>
				<p class="text-xs text-[var(--color-text-subtle)] mt-1">24 hours</p>
			</div>
			<div class="card p-4">
				<p class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Error Rate</p>
				<p class="text-2xl font-bold {summary.error_rate_24h > 0.05 ? 'text-red-400' : 'text-[var(--color-text)]'}">
					{formatPct(summary.error_rate_24h)}
				</p>
				<p class="text-xs text-[var(--color-text-subtle)] mt-1">24 hours</p>
			</div>
			<div class="card p-4">
				<p class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Avg TTFT</p>
				<p class="text-2xl font-bold text-[var(--color-text)]">
					{summary.avg_ttft_ms != null ? `${summary.avg_ttft_ms.toFixed(0)}ms` : '—'}
				</p>
			</div>
			<div class="card p-4">
				<p class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Avg TPS</p>
				<p class="text-2xl font-bold text-[var(--color-text)]">
					{summary.avg_tps != null ? summary.avg_tps.toFixed(1) : '—'}
				</p>
			</div>
		</div>

		<!-- Charts -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
			<!-- Requests Chart -->
			<div class="card p-4">
				<h2 class="text-sm font-medium text-[var(--color-text-muted)] mb-4">Requests Over Time</h2>
				{#if rollups.length > 0}
					<div class="flex items-end gap-0.5 h-36">
						{#each rollups as rollup, i (i)}
							{@const pct = (rollup.requests / maxRequests) * 100}
							<div
								class="flex-1 bg-cyan-500/70 hover:bg-cyan-400 rounded-t-sm transition-colors cursor-default"
								style="height: {Math.max(pct, 1)}%"
								title="{rollup.requests} requests — {formatTime(rollup.timestamp)}"
							></div>
						{/each}
					</div>
					<div class="flex justify-between mt-2 text-xs text-[var(--color-text-subtle)]">
						<span>{formatTime(rollups[0]?.timestamp ?? '')}</span>
						<span>{formatTime(rollups[rollups.length - 1]?.timestamp ?? '')}</span>
					</div>
				{:else}
					<div class="flex items-center justify-center h-36 text-[var(--color-text-subtle)] text-sm">No data</div>
				{/if}
			</div>

			<!-- Tokens Chart -->
			<div class="card p-4">
				<h2 class="text-sm font-medium text-[var(--color-text-muted)] mb-4">Tokens Over Time</h2>
				{#if rollups.length > 0}
					<div class="flex items-end gap-0.5 h-36">
						{#each rollups as rollup, i (i)}
							{@const pct = (rollup.tokens / maxTokens) * 100}
							<div
								class="flex-1 bg-violet-500/70 hover:bg-violet-400 rounded-t-sm transition-colors cursor-default"
								style="height: {Math.max(pct, 1)}%"
								title="{formatNum(rollup.tokens)} tokens — {formatTime(rollup.timestamp)}"
							></div>
						{/each}
					</div>
					<div class="flex justify-between mt-2 text-xs text-[var(--color-text-subtle)]">
						<span>{formatTime(rollups[0]?.timestamp ?? '')}</span>
						<span>{formatTime(rollups[rollups.length - 1]?.timestamp ?? '')}</span>
					</div>
				{:else}
					<div class="flex items-center justify-center h-36 text-[var(--color-text-subtle)] text-sm">No data</div>
				{/if}
			</div>
		</div>

		<!-- Backend Health Table -->
		<div class="table-container">
			<div class="px-4 py-3 border-b border-[var(--color-border-subtle)]">
				<h2 class="text-sm font-medium text-[var(--color-text-muted)]">Backend Status</h2>
			</div>
			<table>
				<thead>
					<tr>
						<th>Backend</th>
						<th>Health</th>
						<th>Latency</th>
					</tr>
				</thead>
				<tbody>
					{#each summary.backends as b (b.id)}
						<tr>
							<td class="text-[var(--color-text)]">{b.name}</td>
							<td>
								<div class="flex items-center gap-2">
									<span class="w-2 h-2 rounded-full {b.health === 'healthy' ? 'bg-green-500' : b.health === 'degraded' ? 'bg-yellow-500' : b.health === 'unhealthy' ? 'bg-red-500' : 'bg-gray-500'}"></span>
									<span class="text-[var(--color-text-muted)] capitalize">{b.health}</span>
								</div>
							</td>
							<td class="text-[var(--color-text-muted)]">
								{b.latency_ms != null ? `${b.latency_ms}ms` : '—'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-4 text-right">
			<a
				href="/metrics"
				target="_blank"
				class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
			>
				View Prometheus metrics →
			</a>
		</div>
	{/if}
</div>

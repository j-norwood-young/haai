<script lang="ts">
	import { api } from '$lib/api.js';
	import { sse } from '$lib/sse.svelte.js';
	import type { MetricsSummary, MetricsRollup } from '$lib/api.js';

	let summary = $state<MetricsSummary | null>(null);
	let rollups = $state<MetricsRollup[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	async function load() {
		try {
			const since = new Date(Date.now() - 86400 * 1000).toISOString();
			const [nextSummary, nextRollups] = await Promise.all([
				api.getMetricsSummary(),
				api.getMetricsRollups({ period: 'hour', limit: 24, since })
			]);
			summary = nextSummary;
			rollups = nextRollups;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load metrics';
		} finally {
			loading = false;
		}
	}

	const maxRequests = $derived(
		rollups.length > 0 ? Math.max(...rollups.map((r) => r.requests), 1) : 1
	);

	$effect(() => {
		void sse.latestEvent;
		load();
	});

	function formatNum(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return String(n);
	}

	function formatPct(n: number): string {
		return `${(n * 100).toFixed(2)}%`;
	}

	function healthBadgeClass(health: string): string {
		switch (health) {
			case 'healthy':
				return 'badge badge-green';
			case 'degraded':
				return 'badge badge-yellow';
			case 'unhealthy':
				return 'badge badge-red';
			default:
				return 'badge badge-gray';
		}
	}

	function formatTime(ts: string): string {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>Dashboard — HAAI</title>
</svelte:head>

<div class="page">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-[var(--color-text)]">Dashboard</h1>
		<p class="text-sm text-[var(--color-text-muted)] mt-1">24-hour overview</p>
	</div>

	{#if loading}
		<!-- Skeleton loading state -->
		<div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
			{#each Array.from({ length: 5 }) as _, i (i)}
				<div class="card p-4">
					<div class="flex items-start gap-3">
						<div class="skeleton w-8 h-8 rounded-lg shrink-0"></div>
						<div class="flex-1">
							<div class="skeleton h-2.5 w-20 mb-3 rounded"></div>
							<div class="skeleton h-7 w-14 rounded"></div>
						</div>
					</div>
				</div>
			{/each}
		</div>
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="lg:col-span-2 card p-4">
				<div class="skeleton h-4 w-48 mb-4 rounded"></div>
				<div class="skeleton h-36 w-full rounded"></div>
			</div>
			<div class="card p-4">
				<div class="skeleton h-4 w-32 mb-4 rounded"></div>
				<div class="space-y-3">
			{#each Array.from({ length: 4 }) as _, i (i)}
					<div class="skeleton h-8 w-full rounded"></div>
				{/each}
				</div>
			</div>
		</div>
	{:else if error}
		<div class="rounded-lg bg-red-900/20 border border-red-800/50 px-4 py-3 text-red-400 text-sm flex items-center gap-2">
			<svg
				class="w-4 h-4 shrink-0"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path
					d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
				/>
			</svg>
			{error}
		</div>
	{:else if summary}
		<!-- Stats Cards -->
		<div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
			<!-- Requests -->
			<div class="card p-4 flex items-start gap-3">
				<div class="bg-cyan-500/10 text-cyan-400 p-1.5 rounded-lg shrink-0">
					<svg
						class="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
						/>
					</svg>
				</div>
				<div class="min-w-0">
					<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">
						Requests (24h)
					</p>
					<p class="text-2xl font-bold text-cyan-400">
						{formatNum(summary.total_requests_24h)}
					</p>
				</div>
			</div>

			<!-- Tokens -->
			<div class="card p-4 flex items-start gap-3">
				<div class="bg-violet-500/10 text-violet-400 p-1.5 rounded-lg shrink-0">
					<svg
						class="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
						/>
					</svg>
				</div>
				<div class="min-w-0">
					<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">
						Tokens (24h)
					</p>
					<p class="text-2xl font-bold text-violet-400">
						{formatNum(summary.total_tokens_24h)}
					</p>
				</div>
			</div>

			<!-- Error Rate -->
			<div class="card p-4 flex items-start gap-3">
				<div
					class={`p-1.5 rounded-lg shrink-0 ${summary.error_rate_24h > 0.05 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}
				>
					<svg
						class="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
						/>
					</svg>
				</div>
				<div class="min-w-0">
					<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">
						Error Rate
					</p>
					<p
						class={`text-2xl font-bold ${summary.error_rate_24h > 0.05 ? 'text-red-400' : 'text-emerald-400'}`}
					>
						{formatPct(summary.error_rate_24h)}
					</p>
				</div>
			</div>

			<!-- Avg TTFT -->
			<div class="card p-4 flex items-start gap-3">
				<div class="bg-amber-500/10 text-amber-400 p-1.5 rounded-lg shrink-0">
					<svg
						class="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
					</svg>
				</div>
				<div class="min-w-0">
					<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">
						Avg TTFT
					</p>
					<p class="text-2xl font-bold text-amber-400">
						{summary.avg_ttft_ms != null ? `${summary.avg_ttft_ms.toFixed(0)}ms` : '—'}
					</p>
				</div>
			</div>

			<!-- Avg TPS -->
			<div class="card p-4 flex items-start gap-3">
				<div class="bg-emerald-500/10 text-emerald-400 p-1.5 rounded-lg shrink-0">
					<svg
						class="w-4 h-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
						/>
					</svg>
				</div>
				<div class="min-w-0">
					<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">
						Avg TPS
					</p>
					<p class="text-2xl font-bold text-emerald-400">
						{summary.avg_tps != null ? summary.avg_tps.toFixed(1) : '—'}
					</p>
				</div>
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Request Volume Chart -->
			<div class="lg:col-span-2 card p-4">
				<h2 class="text-sm font-medium text-[var(--color-text-muted)] mb-4">
					Request Volume (Last 24h)
				</h2>
				{#if rollups.length > 0}
					<div class="relative h-36">
						<!-- Horizontal gridlines -->
						<div
							class="absolute inset-0 pointer-events-none"
							style="background-image: repeating-linear-gradient(to bottom, transparent, transparent calc(25% - 1px), rgba(48,54,61,0.6) calc(25% - 1px), rgba(48,54,61,0.6) 25%);"
							aria-hidden="true"
						></div>
						<!-- Max value label -->
						<span
							class="absolute top-1 left-1 text-xs text-[var(--color-text-subtle)] z-10 leading-none"
						>
							{formatNum(maxRequests)}
						</span>
						<!-- Bars -->
						<div class="flex items-end gap-0.5 h-full">
							{#each rollups as rollup, i (i)}
								{@const pct = (rollup.requests / maxRequests) * 100}
								<div
									class="flex-1 rounded-t-sm hover:opacity-75 transition-opacity cursor-default"
									style="height: {Math.max(pct, 2)}%; background: linear-gradient(to top, #06b6d4, #22d3ee);"
									title="{rollup.requests} requests at {formatTime(rollup.timestamp)}"
								></div>
							{/each}
						</div>
					</div>
					<div
						class="flex justify-between mt-2 text-xs text-[var(--color-text-subtle)]"
					>
						<span>{formatTime(rollups[0]?.timestamp ?? '')}</span>
						<span>{formatTime(rollups[rollups.length - 1]?.timestamp ?? '')}</span>
					</div>
				{:else}
					<div class="flex items-center justify-center h-36 text-[var(--color-text-subtle)] text-sm">
						No data
					</div>
				{/if}
			</div>

			<!-- Backend Health -->
			<div class="card p-4">
				<h2 class="text-sm font-medium text-[var(--color-text-muted)] mb-4">Backend Health</h2>
				{#if summary.backends.length === 0}
					<p class="text-[var(--color-text-subtle)] text-sm">No backends configured</p>
				{:else}
					<div class="space-y-2">
						{#each summary.backends as backend (backend.name)}
							<div
								class="flex items-center gap-3 py-2 px-3 rounded-lg bg-[var(--color-surface-3)] border border-[var(--color-border-subtle)]"
							>
								<svg
									class={`w-2 h-2 shrink-0 ${backend.health === 'healthy' ? 'text-[var(--color-success)]' : backend.health === 'degraded' ? 'text-[var(--color-warning)]' : backend.health === 'unhealthy' ? 'text-[var(--color-error)]' : 'text-gray-500'}`}
									viewBox="0 0 8 8"
									fill="currentColor"
									aria-hidden="true"
								>
									<circle cx="4" cy="4" r="4" />
								</svg>
								<span class="flex-1 text-sm text-[var(--color-text)] truncate">{backend.name}</span>
								<div class="flex items-center gap-2 shrink-0">
									{#if backend.latency_ms != null}
										<span class="text-xs text-[var(--color-text-subtle)]"
											>{backend.latency_ms}ms</span
										>
									{/if}
									<span class={healthBadgeClass(backend.health)}>{backend.health}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

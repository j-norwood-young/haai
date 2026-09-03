<script lang="ts">
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import InfoTip from '$lib/components/InfoTip.svelte';
	import StatusDot from '$lib/components/charts/StatusDot.svelte';
	import { sse } from '$lib/sse.svelte.js';
	import { live } from '$lib/dashboard/live-state.svelte.js';
	import LiveStatusStrip from '$lib/components/dashboard/LiveStatusStrip.svelte';
	import KpiCard from '$lib/components/dashboard/KpiCard.svelte';
	import LiveThroughputChart from '$lib/components/dashboard/LiveThroughputChart.svelte';
	import ActiveRequestsPanel from '$lib/components/dashboard/ActiveRequestsPanel.svelte';
	import BackendFleetCard from '$lib/components/dashboard/BackendFleetCard.svelte';
	import PerformanceBreakdown from '$lib/components/dashboard/PerformanceBreakdown.svelte';
	import RequestVolumeChart from '$lib/components/dashboard/RequestVolumeChart.svelte';
	import RecentErrors from '$lib/components/dashboard/RecentErrors.svelte';
	import { api } from '$lib/api.js';
	import type { Backend, MetricsRollup, MetricsSummary } from '$lib/api.js';
	import { formatNum, formatPct, formatMs } from '$lib/format.js';

	type Window = '1h' | '6h' | '24h';

	const WINDOWS: Window[] = ['1h', '6h', '24h'];
	const WINDOW_MS: Record<Window, number> = {
		'1h': 3600 * 1000,
		'6h': 6 * 3600 * 1000,
		'24h': 24 * 3600 * 1000
	};
	const WINDOW_LABEL: Record<Window, string> = { '1h': '1h', '6h': '6h', '24h': '24h' };
	const ROLLUP_PERIOD: Record<Window, { period: string; limit: number }> = {
		'1h': { period: 'minute', limit: 60 },
		'6h': { period: '5min', limit: 72 },
		'24h': { period: '15min', limit: 96 }
	};

	let window = $state<Window>('24h');
	let summary = $state<MetricsSummary | null>(null);
	let rollups = $state<MetricsRollup[]>([]);
	let backendDetails = $state<Backend[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let lastUpdated = $state<number>(Date.now());

	let breakdownRef: PerformanceBreakdown | null = $state(null);

	let nowTick = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (nowTick = Date.now()), 1000);
		return () => clearInterval(t);
	});

	let loadSeq = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let fallbackTimer: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		const saved = localStorage.getItem('haai.dashboard.window');
		if (saved === '1h' || saved === '6h' || saved === '24h') window = saved;

		live.init();
		return () => live.destroy();
	});

	function setWindow(w: Window) {
		window = w;
		localStorage.setItem('haai.dashboard.window', w);
	}

	async function loadWindow() {
		const my = ++loadSeq;
		const since = new Date(Date.now() - WINDOW_MS[window]).toISOString();
		const { period, limit } = ROLLUP_PERIOD[window];
		try {
			const [nextSummary, nextRollups, nextBackends] = await Promise.all([
				api.getMetricsSummary({ since }),
				api.getMetricsRollups({ period, limit, since }),
				api.getBackends()
			]);
			if (my !== loadSeq) return;
			summary = nextSummary;
			rollups = nextRollups;
			backendDetails = nextBackends;
			error = null;
			lastUpdated = Date.now();
		} catch (err) {
			if (my !== loadSeq) return;
			error = err instanceof Error ? err.message : 'Failed to load metrics';
		} finally {
			if (my === loadSeq) loading = false;
		}
	}

	$effect(() => {
		void window;
		void loadWindow();
	});

	// Debounced refresh on usage/health SSE traffic; live sections never refetch on live-tick.
	$effect(() => {
		const unsub = sse.subscribe((ev) => {
			if (ev.type !== 'usage-event' && ev.type !== 'backend-health') return;
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				debounceTimer = null;
				void loadWindow();
				breakdownRef?.refreshDebounced();
			}, 2000);
		});
		return () => {
			unsub();
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
		};
	});

	// Fallback refresh every 60 s while SSE is disconnected.
	$effect(() => {
		if (sse.connected) {
			if (fallbackTimer) {
				clearInterval(fallbackTimer);
				fallbackTimer = null;
			}
			return;
		}
		if (!fallbackTimer) {
			fallbackTimer = setInterval(() => void loadWindow(), 60_000);
		}
		return () => {
			if (fallbackTimer) {
				clearInterval(fallbackTimer);
				fallbackTimer = null;
			}
		};
	});

	const backendHealthMap = $derived(
		new Map(summary?.backends.map((b) => [b.id, b.health]) ?? [])
	);

	const kpiSparkRequests = $derived(rollups.map((r) => r.requests));
	const kpiSparkTokens = $derived(rollups.map((r) => r.tokens));
	const kpiSparkErrors = $derived(rollups.map((r) => (r.requests > 0 ? r.errors / r.requests : 0)));
	const kpiSparkLatency = $derived(rollups.map((r) => r.avg_latency_ms ?? 0));

	function subtitle(): string {
		const age = Math.max(0, Math.round((Date.now() - lastUpdated) / 1000));
		void nowTick;
		return `Live · updated ${age}s ago`;
	}
</script>

<svelte:head>
	<title>Dashboard — HAAI</title>
</svelte:head>

<div class="page">
	<PageHeader title="Dashboard" subtitle={subtitle()}>
		{#snippet actions()}
			<div class="flex items-center gap-3">
				<div class="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
					<StatusDot status={sse.connected ? 'healthy' : 'degraded'} pulse={sse.connected} />
					<span>{sse.connected ? 'Live' : 'Reconnecting'}</span>
				</div>
				<div class="flex items-center gap-1" role="group" aria-label="Time window">
					{#each WINDOWS as w (w)}
						<button
							type="button"
							class="{window === w ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}"
							data-testid="window-{w}"
							onclick={() => setWindow(w)}
						>
							{WINDOW_LABEL[w]}
						</button>
					{/each}
				</div>
			</div>
		{/snippet}
	</PageHeader>

	{#if error && summary}
		<div class="rounded-lg bg-red-900/20 border border-red-800/50 px-4 py-3 text-red-400 text-sm flex items-center justify-between gap-2 mb-4">
			<span>{error} — showing last good data</span>
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => void loadWindow()}>Retry</button>
		</div>
	{:else if error}
		<div class="rounded-lg bg-red-900/20 border border-red-800/50 px-4 py-3 text-red-400 text-sm flex items-center justify-between gap-2 mb-4">
			<span>{error}</span>
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => void loadWindow()}>Retry</button>
		</div>
	{/if}

	{#if loading && !summary}
		<!-- Skeleton on first load only -->
		<div class="mb-4">
			<div class="card p-4">
				<div class="skeleton h-16 w-full rounded"></div>
			</div>
		</div>
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
	{:else if summary}
		<div class="mb-4">
			<LiveStatusStrip />
		</div>

		<div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6" data-testid="kpi-requests">
			<KpiCard
				icon="requests"
				label="Requests"
				window={WINDOW_LABEL[window]}
				value={formatNum(summary.total_requests_24h)}
				valueClass="text-cyan-400"
				current={summary.total_requests_24h}
				previous={summary.previous?.total_requests}
				sparkline={kpiSparkRequests}
				href="/analytics"
				testid="kpi-card-requests"
			/>
			<KpiCard
				icon="tokens"
				label="Tokens"
				window={WINDOW_LABEL[window]}
				value={formatNum(summary.total_tokens_24h)}
				valueClass="text-violet-400"
				current={summary.total_tokens_24h}
				previous={summary.previous?.total_tokens}
				sparkline={kpiSparkTokens}
				sparklineColor="#a78bfa"
				href="/analytics"
				testid="kpi-card-tokens"
			/>
			<KpiCard
				icon="errors"
				label="Error rate"
				window={WINDOW_LABEL[window]}
				value={formatPct(summary.error_rate_24h)}
				valueClass={summary.error_rate_24h > 0.05 ? 'text-red-400' : 'text-emerald-400'}
				current={summary.error_rate_24h}
				previous={summary.previous?.error_rate}
				downIsGood={true}
				sparkline={kpiSparkErrors}
				sparklineColor="#f87171"
				href="/analytics"
				testid="kpi-card-errors"
			/>
			<div data-testid="kpi-ttft">
				<KpiCard
					icon="ttft"
					label="TTFT"
					window={WINDOW_LABEL[window]}
					value={summary.p50_ttft_ms != null ? formatMs(summary.p50_ttft_ms) : '—'}
					valueClass="text-amber-400"
					current={summary.avg_ttft_ms}
					previous={summary.previous?.avg_ttft_ms}
					downIsGood={true}
					sparkline={kpiSparkLatency}
					sparklineColor="#fbbf24"
					href="/analytics"
					testid="kpi-card-ttft"
				/>
				<p class="text-[10px] text-[var(--color-text-subtle)] mt-1 px-1">
					p95 {summary.p95_ttft_ms != null ? formatMs(summary.p95_ttft_ms) : '—'}
				</p>
			</div>
			<div data-testid="kpi-tps">
				<KpiCard
					icon="tps"
					label="TPS"
					window={WINDOW_LABEL[window]}
					value={summary.avg_tps != null ? summary.avg_tps.toFixed(1) : '—'}
					valueClass="text-emerald-400"
					sparkline={kpiSparkRequests}
					sparklineColor="var(--color-success)"
					href="/analytics"
					testid="kpi-card-tps"
				/>
				<p class="text-[10px] text-[var(--color-text-subtle)] mt-1 px-1">
					p50 {summary.p50_tps != null ? summary.p50_tps.toFixed(1) : '—'} · max {summary.max_tps != null ? summary.max_tps.toFixed(1) : '—'}
				</p>
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
			<div class="lg:col-span-2">
				<LiveThroughputChart />
			</div>
			<ActiveRequestsPanel />
		</div>

		<div class="mb-6">
			<div class="flex items-center justify-between mb-2">
				<h2 class="text-sm font-medium text-[var(--color-text-muted)]">Backend fleet</h2>
				<InfoTip text="Health, probe history, concurrency and circuit state for each backend. maxConcurrency is capacity as configured (not enforced)." />
			</div>
			<BackendFleetCard
				backends={summary.backends}
				backendDetails={backendDetails}
				onrefresh={() => void loadWindow()}
			/>
		</div>

		<div class="mb-6">
			<PerformanceBreakdown
				bind:this={breakdownRef}
				since={new Date(Date.now() - WINDOW_MS[window]).toISOString()}
				window={WINDOW_LABEL[window]}
				backendHealth={backendHealthMap}
			/>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="lg:col-span-2">
				<RequestVolumeChart {rollups} window={WINDOW_LABEL[window]} />
			</div>
			<RecentErrors
				since={new Date(Date.now() - WINDOW_MS[window]).toISOString()}
				window={WINDOW_LABEL[window]}
			/>
		</div>
	{/if}
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import Sparkline from '$lib/components/charts/Sparkline.svelte';
	import StatusDot from '$lib/components/charts/StatusDot.svelte';
	import InfoTip from '$lib/components/InfoTip.svelte';
	import { api } from '$lib/api.js';
	import type { BreakdownBy, BreakdownGroup } from '$lib/api.js';
	import { formatNum, formatPct, formatMs, relativeTime } from '$lib/format.js';

	interface Props {
		since: string;
		window: string;
		/** backend id -> health, used for status dots on backend/vmodel rows */
		backendHealth?: Map<string, 'healthy' | 'degraded' | 'unhealthy' | 'unknown'> | undefined;
	}

	let { since, window: windowLabel, backendHealth }: Props = $props();

	type SortKey =
		| 'requests'
		| 'error_rate'
		| 'total_tokens'
		| 'ttft_p50_ms'
		| 'ttft_p95_ms'
		| 'duration_p50_ms'
		| 'duration_p95_ms'
		| 'tps_avg'
		| 'tool_calls'
		| 'last_seen';

	const TABS: Array<{ id: BreakdownBy; label: string }> = [
		{ id: 'backend', label: 'Backends' },
		{ id: 'vmodel', label: 'Virtual Models' },
		{ id: 'backendModel', label: 'Backend Models' }
	];

	let tab = $state<BreakdownBy>('backend');
	let groups = $state<BreakdownGroup[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let sortKey = $state<SortKey>('requests');
	let sortAsc = $state(false);

	let loadSeq = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		const saved = localStorage.getItem('haai.dashboard.breakdownTab');
		if (saved === 'backend' || saved === 'vmodel' || saved === 'backendModel') {
			tab = saved;
		}
	});

	function persistTab() {
		localStorage.setItem('haai.dashboard.breakdownTab', tab);
	}

	async function load() {
		const my = ++loadSeq;
		try {
			const res = await api.getMetricsBreakdown({ by: tab, since });
			if (my !== loadSeq) return;
			groups = res.groups;
			error = null;
		} catch (err) {
			if (my !== loadSeq) return;
			error = err instanceof Error ? err.message : 'Failed to load breakdown';
		} finally {
			if (my === loadSeq) loading = false;
		}
	}

	/** Debounced refresh — coalesces bursts of usage-event SSE traffic. */
	export function refreshDebounced() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			void load();
		}, 2000);
	}

	$effect(() => {
		void tab;
		void since;
		persistTab();
		void load();
	});

	const sorted = $derived.by(() => {
		const rows = [...groups];
		rows.sort((a, b) => {
			const av = a[sortKey] ?? 0;
			const bv = b[sortKey] ?? 0;
			return sortAsc ? av - bv : bv - av;
		});
		return rows;
	});

	const maxRequests = $derived(Math.max(1, ...groups.map((g) => g.requests)));

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortAsc = !sortAsc;
		} else {
			sortKey = key;
			sortAsc = false;
		}
	}

	function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
		if (sortKey !== key) return 'none';
		return sortAsc ? 'ascending' : 'descending';
	}

	function rowHref(g: BreakdownGroup): string {
		if (tab === 'backend') return `/analytics?backendId=${encodeURIComponent(g.key)}`;
		if (tab === 'vmodel') return `/analytics?vmodelId=${encodeURIComponent(g.key)}`;
		return `/analytics?backendModelId=${encodeURIComponent(g.backendModelId ?? '')}&backendId=${encodeURIComponent(g.backendId ?? '')}`;
	}
</script>

<div class="card p-4" data-testid="perf-breakdown">
	<div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
		<h2 class="text-sm font-medium text-[var(--color-text-muted)]">Performance breakdown · {windowLabel}</h2>
		<div class="flex items-center gap-2" role="tablist" aria-label="Breakdown dimension">
			{#each TABS as t (t.id)}
				<button
					type="button"
					role="tab"
					aria-selected={tab === t.id}
					class="{tab === t.id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}"
					onclick={() => (tab = t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>
	</div>

	{#if loading}
		<div class="space-y-2">
			{#each Array.from({ length: 4 }) as _, i (i)}
				<div class="skeleton h-8 w-full rounded"></div>
			{/each}
		</div>
	{:else if error}
		<div class="rounded-lg bg-red-900/20 border border-red-800/50 px-4 py-3 text-red-400 text-sm flex items-center justify-between gap-2">
			<span>{error}</span>
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => void load()}>Retry</button>
		</div>
	{:else if sorted.length === 0}
		<p class="text-sm text-[var(--color-text-subtle)] text-center py-8">
			No requests in this window
		</p>
	{:else}
		<div class="overflow-x-auto -mx-1">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-[10px] uppercase tracking-wider text-[var(--color-text-subtle)]">
						<th>Name</th>
						<th>
							<button type="button" class="uppercase tracking-wider" aria-sort={ariaSort('requests')} onclick={() => toggleSort('requests')}>
								Requests {sortKey === 'requests' ? (sortAsc ? '▲' : '▼') : ''}
							</button>
						</th>
						<th>
							<button type="button" class="uppercase tracking-wider" aria-sort={ariaSort('error_rate')} onclick={() => toggleSort('error_rate')}>
								Errors {sortKey === 'error_rate' ? (sortAsc ? '▲' : '▼') : ''}
							</button>
						</th>
						<th>
							<button type="button" class="uppercase tracking-wider" aria-sort={ariaSort('total_tokens')} onclick={() => toggleSort('total_tokens')}>
								Tokens {sortKey === 'total_tokens' ? (sortAsc ? '▲' : '▼') : ''}
							</button>
						</th>
						<th>
							<button type="button" class="uppercase tracking-wider" aria-sort={ariaSort('ttft_p50_ms')} onclick={() => toggleSort('ttft_p50_ms')}>
								TTFT p50/p95 {sortKey === 'ttft_p50_ms' ? (sortAsc ? '▲' : '▼') : ''}
							</button>
							<InfoTip text="p95 TTFT: 95% of requests received their first token faster than this." />
						</th>
						<th>
							<button type="button" class="uppercase tracking-wider" aria-sort={ariaSort('duration_p50_ms')} onclick={() => toggleSort('duration_p50_ms')}>
								Duration p50/p95 {sortKey === 'duration_p50_ms' ? (sortAsc ? '▲' : '▼') : ''}
							</button>
						</th>
						<th>
							<button type="button" class="uppercase tracking-wider" aria-sort={ariaSort('tps_avg')} onclick={() => toggleSort('tps_avg')}>
								TPS p50/max {sortKey === 'tps_avg' ? (sortAsc ? '▲' : '▼') : ''}
							</button>
						</th>
						<th>
							<button type="button" class="uppercase tracking-wider" aria-sort={ariaSort('tool_calls')} onclick={() => toggleSort('tool_calls')}>
								Tools {sortKey === 'tool_calls' ? (sortAsc ? '▲' : '▼') : ''}
							</button>
						</th>
						<th>Trend</th>
						<th>
							<button type="button" class="uppercase tracking-wider" aria-sort={ariaSort('last_seen')} onclick={() => toggleSort('last_seen')}>
								Last seen {sortKey === 'last_seen' ? (sortAsc ? '▲' : '▼') : ''}
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each sorted as g (g.key)}
						<tr class="hover:bg-[var(--color-surface-3)] cursor-pointer border-b border-[var(--color-border-subtle)] last:border-0">
							<td class="py-2 pr-3">
								<a href={rowHref(g)} class="flex items-center gap-2 text-[var(--color-text)] hover:text-[var(--color-brand)] transition-colors">
									{#if tab === 'backend' && backendHealth?.get(g.key)}
										<StatusDot status={backendHealth.get(g.key)!} />
									{/if}
									<span class="truncate max-w-[220px]">{g.name ?? g.key}</span>
								</a>
							</td>
							<td class="py-2 pr-3 whitespace-nowrap">
								<div class="flex items-center gap-2">
									<span class="tabular-nums text-[var(--color-text)]">{formatNum(g.requests)}</span>
									<span class="hidden xl:block h-1.5 w-16 rounded-full bg-[var(--color-surface-3)] overflow-hidden shrink-0">
										<span class="block h-full bg-[var(--color-brand)]" style="width: {(g.requests / maxRequests) * 100}%"></span>
									</span>
								</div>
							</td>
							<td class="py-2 pr-3 tabular-nums {g.error_rate > 0.05 ? 'text-red-400' : 'text-[var(--color-text-muted)]'}">
								{formatPct(g.error_rate)}
							</td>
							<td class="py-2 pr-3 tabular-nums text-[var(--color-text-muted)]" title="prompt {formatNum(g.prompt_tokens)} / completion {formatNum(g.completion_tokens)}">
								{formatNum(g.total_tokens)}
							</td>
							<td class="py-2 pr-3 tabular-nums text-amber-400 whitespace-nowrap">
								{#if g.ttft_p50_ms != null}
									{formatMs(g.ttft_p50_ms)} / {formatMs(g.ttft_p95_ms ?? 0)}
								{:else}
									—
								{/if}
							</td>
							<td class="py-2 pr-3 tabular-nums text-[var(--color-text-muted)] whitespace-nowrap">
								{#if g.duration_p50_ms != null}
									{formatMs(g.duration_p50_ms)} / {formatMs(g.duration_p95_ms ?? 0)}
								{:else}
									—
								{/if}
							</td>
						<td class="py-2 pr-3 tabular-nums text-emerald-400 whitespace-nowrap">
							{#if g.tps_avg != null}
								{g.tps_avg.toFixed(1)} / {g.tps_max != null ? g.tps_max.toFixed(1) : '—'}
							{:else}
								—
							{/if}
						</td>
							<td class="py-2 pr-3 tabular-nums text-[var(--color-text-muted)]">{g.tool_calls}</td>
							<td class="py-2 pr-3">
								<div class="w-24 h-7">
									<Sparkline values={g.sparkline} color="var(--color-brand)" ariaLabel="Request trend for {g.name ?? g.key}" />
								</div>
							</td>
							<td class="py-2 text-[var(--color-text-subtle)] whitespace-nowrap">{relativeTime(g.last_seen)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

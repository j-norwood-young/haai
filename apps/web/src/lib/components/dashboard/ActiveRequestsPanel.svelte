<script lang="ts">
	import { live } from '$lib/dashboard/live-state.svelte.js';
	import StatusDot from '$lib/components/charts/StatusDot.svelte';
	import { formatDuration } from '$lib/format.js';
	import type { InFlightRequest } from '$lib/api.js';

	let now = $state(Date.now());
	let timer: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		timer = setInterval(() => (now = Date.now()), 250);
		return () => {
			if (timer) clearInterval(timer);
		};
	});

	const rows = $derived(live.inFlight.slice(0, 50));

	type Phase = 'connecting' | 'waiting' | 'streaming' | 'buffering';

	function phaseOf(r: InFlightRequest): Phase {
		if (r.firstTokenAt != null) return r.stream ? 'streaming' : 'buffering';
		return now - r.startedAt < 1000 ? 'connecting' : 'waiting';
	}

	const phaseMeta: Record<Phase, { label: string; class: string; dot: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'; pulse: boolean }> = {
		connecting: { label: 'connecting', class: 'badge-gray', dot: 'unknown', pulse: false },
		waiting: { label: 'waiting for first token', class: 'badge-yellow', dot: 'degraded', pulse: true },
		streaming: { label: 'streaming', class: 'badge-green', dot: 'healthy', pulse: true },
		buffering: { label: 'buffering', class: 'badge-violet', dot: 'degraded', pulse: false }
	};

	function tokPerSec(r: InFlightRequest): number | null {
		if (r.firstTokenAt == null || r.completionTokens === 0) return null;
		const secs = (now - r.firstTokenAt) / 1000;
		if (secs <= 0) return null;
		return r.completionTokens / secs;
	}
</script>

<div class="card p-4 flex flex-col" data-testid="active-requests">
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-sm font-medium text-[var(--color-text-muted)]">Active requests</h2>
		<span class="text-xs text-[var(--color-text-subtle)] tabular-nums">{live.inFlightTotal}</span>
	</div>
	{#if rows.length === 0}
		<div class="flex-1 flex flex-col items-center justify-center py-10 gap-3">
			<svg
				class="w-12 h-12 text-[var(--color-text-subtle)] opacity-40"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="1.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="8.25" />
				<path d="M8.25 12h7.5m0 0-3-3m3 3-3 3" />
			</svg>
			<p class="text-sm text-[var(--color-text-subtle)]">No requests in flight</p>
		</div>
	{:else}
		<ul class="flex-1 overflow-y-auto space-y-1.5 max-h-[220px]">
			{#each rows as r (r.id)}
				{@const phase = phaseOf(r)}
				{@const meta = phaseMeta[phase]}
				{@const rate = tokPerSec(r)}
				<li class="dashboard-row flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-[var(--color-surface-3)] text-sm">
					<StatusDot status={meta.dot} pulse={meta.pulse} />
					<span class="font-mono text-xs text-[var(--color-text-muted)] shrink-0">{r.keyPrefix}</span>
					<span class="min-w-0 flex-1 truncate text-[var(--color-text)]" title="{r.vmodelName} → {r.backendName} / {r.backendModelId}">
						{r.vmodelName} → {r.backendName} / {r.backendModelId}
					</span>
					{#if r.attempt > 1}
						<span class="badge badge-yellow shrink-0">failover ×{r.attempt}</span>
					{/if}
					<span class="badge {meta.class} shrink-0 hidden md:inline-block">{meta.label}</span>
					<span class="text-xs text-[var(--color-text-subtle)] tabular-nums shrink-0 w-14 text-right">
						{formatDuration(now - r.startedAt)}
					</span>
					<span class="text-xs tabular-nums text-violet-400 shrink-0 w-20 text-right">
						{#if rate != null}
							{r.completionTokens} tok · {rate.toFixed(0)}/s
						{:else}
							{r.completionTokens} tok
						{/if}
					</span>
				</li>
			{/each}
		</ul>
		{#if live.inFlightTotal > 50}
			<p class="mt-2 text-xs text-[var(--color-text-subtle)] text-center">
				+{live.inFlightTotal - 50} more
			</p>
		{/if}
	{/if}
</div>

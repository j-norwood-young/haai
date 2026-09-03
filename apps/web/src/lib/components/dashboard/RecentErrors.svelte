<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { MetricsEvent } from '$lib/api.js';
	import { live } from '$lib/dashboard/live-state.svelte.js';
	import { relativeTime } from '$lib/format.js';

	interface Props {
		since: string;
		window: string;
	}

	let { since, window: windowLabel }: Props = $props();

	let serverEvents = $state<MetricsEvent[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let loadSeq = 0;

	async function load() {
		const my = ++loadSeq;
		try {
			const rows = await api.getMetricsEvents({ limit: 20, since, errorsOnly: true });
			if (my !== loadSeq) return;
			serverEvents = rows;
			error = null;
		} catch (err) {
			if (my !== loadSeq) return;
			error = err instanceof Error ? err.message : 'Failed to load errors';
		} finally {
			if (my === loadSeq) loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	$effect(() => {
		void since;
		loading = true;
		void load();
	});

	// Merge server list with live SSE errors (dedupe by id), newest first.
	const rows = $derived.by(() => {
		const seen = new Set<string>();
		const merged: MetricsEvent[] = [];
		for (const ev of live.recentEvents) {
			if (ev.status_code < 400) continue;
			if (seen.has(ev.id)) continue;
			seen.add(ev.id);
			merged.push(ev);
		}
		for (const ev of serverEvents) {
			if (seen.has(ev.id)) continue;
			seen.add(ev.id);
			merged.push(ev);
		}
		return merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 20);
	});

	const liveErrors = $derived(live.recentEvents.filter((e) => e.status_code >= 400).length);
</script>

<div class="card p-4 flex flex-col" data-testid="recent-errors">
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-sm font-medium text-[var(--color-text-muted)]">Recent errors · {windowLabel}</h2>
		{#if liveErrors > 0}
			<span class="badge badge-red">{liveErrors} live</span>
		{/if}
	</div>

	{#if loading}
		<div class="space-y-2">
			{#each Array.from({ length: 3 }) as _, i (i)}
				<div class="skeleton h-8 w-full rounded"></div>
			{/each}
		</div>
	{:else if error}
		<div class="rounded-lg bg-red-900/20 border border-red-800/50 px-4 py-3 text-red-400 text-sm flex items-center justify-between gap-2">
			<span>{error}</span>
			<button type="button" class="btn btn-secondary btn-sm" onclick={() => void load()}>Retry</button>
		</div>
	{:else if rows.length === 0}
		<div class="flex-1 flex flex-col items-center justify-center py-10 gap-2">
			<svg class="w-10 h-10 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="m4.5 12.75 6 6 9-13.5" />
			</svg>
			<p class="text-sm text-[var(--color-text-subtle)]">No errors in the last {windowLabel}</p>
		</div>
	{:else}
		<ul class="space-y-1.5 max-h-[220px] overflow-y-auto">
			{#each rows as ev (ev.id)}
				<li class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-[var(--color-surface-3)] text-sm">
					<span class="text-xs text-[var(--color-text-subtle)] tabular-nums shrink-0 w-14">{relativeTime(ev.created_at)}</span>
					<span class="badge {ev.status_code >= 500 ? 'badge-red' : 'badge-yellow'} shrink-0">{ev.status_code}</span>
					<span class="min-w-0 flex-1 truncate text-[var(--color-text)]" title={ev.error ?? ''}>
						{ev.vmodel}{ev.backend_name ? ` → ${ev.backend_name}` : ''}
					</span>
					<span class="font-mono text-xs text-[var(--color-text-muted)] shrink-0">{ev.key_prefix}</span>
					<span class="text-xs text-red-400 truncate max-w-[40%]" title={ev.error ?? ''}>
						{ev.error ?? 'Request failed'}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="mt-3 text-right">
		<a href="/logs" class="text-xs text-[var(--color-brand)] hover:underline transition-colors">Open Live Logs →</a>
	</div>
</div>

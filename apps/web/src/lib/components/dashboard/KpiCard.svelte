<script lang="ts">
	import Sparkline from '$lib/components/charts/Sparkline.svelte';
	import { deltaPct } from '$lib/format.js';

	interface Props {
		label: string;
		value: string;
		valueClass?: string;
		icon: 'requests' | 'tokens' | 'errors' | 'ttft' | 'tps';
		window: string;
		/** Current / previous for the delta chip */
		current?: number | undefined;
		previous?: number | undefined;
		/** For error rate and TTFT a decrease is good — invert chip colors */
		downIsGood?: boolean;
		sparkline?: number[] | undefined;
		sparklineColor?: string;
		href: string;
		testid: string;
	}

	let {
		label,
		value,
		valueClass = 'text-[var(--color-text)]',
		icon,
		window,
		current,
		previous,
		downIsGood = false,
		sparkline,
		sparklineColor = 'var(--color-brand)',
		href,
		testid
	}: Props = $props();

	const iconWrapClass = $derived(
		{
			requests: 'bg-cyan-500/10 text-cyan-400',
			tokens: 'bg-violet-500/10 text-violet-400',
			errors: 'bg-emerald-500/10 text-emerald-400',
			ttft: 'bg-amber-500/10 text-amber-400',
			tps: 'bg-emerald-500/10 text-emerald-400'
		}[icon]
	);

	const delta = $derived(current != null ? deltaPct(current, previous) : null);
	const deltaUp = $derived(delta != null && delta > 0);
	const good = $derived(delta != null && (downIsGood ? !deltaUp : deltaUp));
</script>

<a
	href={href}
	class="card p-4 flex items-start gap-3 hover:border-[var(--color-border)] transition-colors"
	data-testid={testid}
>
	<div class="{iconWrapClass} p-1.5 rounded-lg shrink-0">
		{#if icon === 'requests'}
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
			</svg>
		{:else if icon === 'tokens'}
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z" />
			</svg>
		{:else if icon === 'errors'}
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
			</svg>
		{:else if icon === 'ttft'}
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
			</svg>
		{:else}
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
			</svg>
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1 truncate">
			{label} · {window}
		</p>
		<div class="flex items-center gap-2">
			<p class="text-2xl font-bold {valueClass} tabular-nums truncate">{value}</p>
			{#if delta != null}
				<span
					class="text-xs font-medium px-1.5 py-0.5 rounded tabular-nums {good
						? 'bg-emerald-500/10 text-emerald-400'
						: 'bg-red-500/10 text-red-400'}"
					data-testid="{testid}-delta"
				>
					{deltaUp ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(0)}%
				</span>
			{/if}
		</div>
		{#if sparkline && sparkline.length > 1}
			<div class="h-7 mt-2">
				<Sparkline values={sparkline} color={sparklineColor} ariaLabel="{label} trend" />
			</div>
		{/if}
	</div>
</a>

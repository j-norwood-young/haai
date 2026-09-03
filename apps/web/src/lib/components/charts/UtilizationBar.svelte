<script lang="ts">
	interface Props {
		value: number;
		max?: number | undefined;
		label?: string;
	}

	let { value, max, label }: Props = $props();

	const pct = $derived(max != null && max > 0 ? Math.min(100, (value / max) * 100) : null);
	const barColor = $derived(
		pct == null
			? 'bg-[var(--color-brand)]'
			: pct < 60
				? 'bg-[var(--color-brand)]'
				: pct < 85
					? 'bg-[var(--color-warning)]'
					: 'bg-[var(--color-error)]'
	);
</script>

<div class="w-full">
	<div class="flex items-center justify-between text-xs mb-1">
		<span class="text-[var(--color-text-subtle)]">{label}</span>
		<span class="tabular-nums text-[var(--color-text-muted)]">
			{value}{max != null ? ` / ${max}` : ''}
		</span>
	</div>
	<div class="h-1.5 w-full rounded-full bg-[var(--color-surface-3)] overflow-hidden">
		{#if pct != null}
			<div class="h-full rounded-full {barColor} transition-[width]" style="width: {pct}%"></div>
		{:else}
			<div class="h-full w-1/3 rounded-full {barColor} animate-pulse"></div>
		{/if}
	</div>
</div>

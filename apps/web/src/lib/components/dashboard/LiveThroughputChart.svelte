<script lang="ts">
	import { live } from '$lib/dashboard/live-state.svelte.js';
	import AreaChart from '$lib/components/charts/AreaChart.svelte';

	const timestamps = $derived(live.series.map((p) => p.t));
	const series = $derived.by(() => {
		if (live.series.length === 0) return [];
		return [
			{
				key: 'completed',
				label: 'Req/s',
				color: 'var(--color-brand)',
				values: live.series.map((p) => p.completed)
			},
			{
				key: 'inFlight',
				label: 'In-flight',
				color: '#fbbf24',
				values: live.series.map((p) => p.inFlight),
				dashed: true
			}
		];
	});
</script>

<div class="card p-4" data-testid="live-throughput">
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-sm font-medium text-[var(--color-text-muted)]">Requests per second</h2>
		<span class="text-xs text-[var(--color-text-subtle)]">Last 10 minutes · 1s resolution</span>
	</div>
	<div class="pb-4">
		<AreaChart
			{series}
			{timestamps}
			height={180}
			yFormat={(n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))}
			ariaLabel="Requests per second and in-flight requests over the last 10 minutes"
		/>
	</div>
</div>

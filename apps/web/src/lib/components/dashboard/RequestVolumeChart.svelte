<script lang="ts">
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import type { MetricsRollup } from '$lib/api.js';
	import { formatNum } from '$lib/format.js';

	interface Props {
		rollups: MetricsRollup[];
		window: string;
	}

	let { rollups, window: windowLabel }: Props = $props();

	const buckets = $derived(
		rollups.map((r) => ({
			t: Date.parse(r.timestamp),
			value: r.requests,
			secondary: r.errors
		}))
	);
</script>

<div class="card p-4" data-testid="request-volume">
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-sm font-medium text-[var(--color-text-muted)]">Request volume · {windowLabel}</h2>
		<div class="flex items-center gap-3 text-xs text-[var(--color-text-subtle)]">
			<span class="flex items-center gap-1">
				<span class="w-2.5 h-2.5 rounded-sm bg-[var(--color-brand)] opacity-70"></span> requests
			</span>
			<span class="flex items-center gap-1">
				<span class="w-2.5 h-2.5 rounded-sm bg-[var(--color-error)]"></span> errors
			</span>
		</div>
	</div>
	<div class="pb-4">
		<BarChart
			{buckets}
			height={150}
			yFormat={(n) => formatNum(n)}
			tooltip={(b) => {
				const rollup = rollups.find((x) => Date.parse(x.timestamp) === b.t);
				return `${b.value} requests · ${b.secondary ?? 0} errors · ${formatNum(rollup?.tokens ?? 0)} tokens`;
			}}
		/>
	</div>
</div>

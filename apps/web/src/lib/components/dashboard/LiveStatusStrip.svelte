<script lang="ts">
	import { live } from '$lib/dashboard/live-state.svelte.js';
	import Sparkline from '$lib/components/charts/Sparkline.svelte';
	import StatusDot from '$lib/components/charts/StatusDot.svelte';
	import { formatNum } from '$lib/format.js';

	const cold = $derived(live.series.length === 0 && live.inFlight.length === 0);
	const inflightSpark = $derived(live.series.slice(-60).map((p) => p.inFlight));
	const rpsSpark = $derived(live.series.slice(-60).map((p) => p.completed));
	const tpsSpark = $derived(live.series.slice(-60).map((p) => p.tokens));
	const errSpark = $derived(live.series.slice(-60).map((p) => p.errors));

	let totalBackends = $derived(live.backends.size);
	let healthyBackends = $derived.by(() => {
		let n = 0;
		for (const [, b] of live.backends) {
			const probes = b.probes;
			const last = probes[probes.length - 1];
			if (!last || last.status === 'healthy') n++;
		}
		return n;
	});
</script>

<div class="card p-4" data-testid="live-status-strip">
	<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
		<!-- In-flight -->
		<div class="min-w-0">
			<div class="flex items-center gap-2 mb-1">
				<StatusDot status={live.inFlight.length > 0 ? 'healthy' : 'unknown'} pulse={live.inFlight.length > 0} />
				<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider">In-flight</p>
			</div>
			<p class="text-xl font-bold text-[var(--color-text)] tabular-nums">
				{cold ? '—' : live.inFlightTotal}
			</p>
			<div class="h-7 mt-1">
				<Sparkline values={inflightSpark} color="var(--color-brand)" ariaLabel="In-flight requests" />
			</div>
		</div>
		<!-- Req/s -->
		<div class="min-w-0">
			<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">Req/s</p>
			<p class="text-xl font-bold text-[var(--color-text)] tabular-nums">
				{cold ? '—' : live.reqPerSec.toFixed(1)}
			</p>
			<div class="h-7 mt-1">
				<Sparkline values={rpsSpark} color="var(--color-brand)" ariaLabel="Requests per second" />
			</div>
		</div>
		<!-- Tokens/s -->
		<div class="min-w-0">
			<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">Tokens/s</p>
			<p class="text-xl font-bold text-violet-400 tabular-nums">
				{cold ? '—' : formatNum(live.tokensPerSec)}
			</p>
			<div class="h-7 mt-1">
				<Sparkline values={tpsSpark} color="#a78bfa" ariaLabel="Tokens per second" />
			</div>
		</div>
		<!-- Errors/min -->
		<div class="min-w-0">
			<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">Errors/min</p>
			<p class="text-xl font-bold {live.errorsPerMin > 0 ? 'text-red-400' : 'text-[var(--color-text)]'} tabular-nums">
				{cold ? '—' : live.errorsPerMin}
			</p>
			<div class="h-7 mt-1">
				<Sparkline values={errSpark} color="#f87171" ariaLabel="Errors per minute" />
			</div>
		</div>
		<!-- Fleet -->
		<div class="min-w-0">
			<p class="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider mb-1">Fleet</p>
			<p class="text-xl font-bold text-[var(--color-text)] tabular-nums">
				{cold ? '—' : `${healthyBackends}/${totalBackends}`}
			</p>
			<div class="mt-1 h-7 flex items-center">
				{#if live.openCircuits > 0}
					<span class="badge badge-red" data-testid="open-circuits">
						{live.openCircuits} open circuit{live.openCircuits > 1 ? 's' : ''}
					</span>
				{:else}
					<span class="text-xs text-[var(--color-text-subtle)]">backends</span>
				{/if}
			</div>
		</div>
	</div>
	{#if cold}
		<p class="mt-3 text-xs text-[var(--color-text-subtle)] text-center">Waiting for traffic</p>
	{/if}
</div>

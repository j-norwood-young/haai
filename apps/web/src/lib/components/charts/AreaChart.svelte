<script lang="ts">
	import { buildAreaPath, buildLinePath, computeDomain } from './path.js';

	export interface AreaSeries {
		key: string;
		label: string;
		color: string;
		values: number[];
		axis?: 'left' | 'right';
		dashed?: boolean;
	}

	interface Props {
		series: AreaSeries[];
		timestamps: number[];
		height?: number;
		yFormat?: (n: number) => string;
		xFormat?: (ts: number) => string;
		legend?: boolean;
		ariaLabel?: string;
	}

	let {
		series,
		timestamps,
		height = 180,
		yFormat = (n) => String(n),
		xFormat = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
		legend = true,
		ariaLabel = 'area chart'
	}: Props = $props();

	const W = 1000;
	const H = 100;
	const PAD = 4;

	let hidden = $state(new Set<string>());
	let hoverIndex = $state<number | null>(null);
	let container: HTMLElement | null = null;

	const count = $derived(Math.max(timestamps.length, ...series.map((s) => s.values.length)));
	const hasData = $derived(timestamps.length >= 2 && series.some((s) => s.values.length >= 2));

	const leftSeries = $derived(series.filter((s) => (s.axis ?? 'left') === 'left' && !hidden.has(s.key)));
	const rightSeries = $derived(series.filter((s) => s.axis === 'right' && !hidden.has(s.key)));

	const leftDomain = $derived(
		computeDomain(leftSeries.flatMap((s) => s.values))
	);
	const rightDomain = $derived(
		rightSeries.length > 0 ? computeDomain(rightSeries.flatMap((s) => s.values)) : { min: 0, max: 1 }
	);

	function domainFor(s: AreaSeries) {
		return s.axis === 'right' ? rightDomain : leftDomain;
	}

	const gridlines = $derived([0, 1, 2, 3].map((i) => PAD + (i / 3) * (H - PAD * 2)));

	function gridValue(yFrac: number, domain: { min: number; max: number }): number {
		return domain.max - yFrac * (domain.max - domain.min);
	}

	function toggle(key: string) {
		const next = new Set(hidden);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		hidden = next;
	}

	function onPointerMove(event: PointerEvent) {
		if (!container || count < 2) return;
		const rect = container.getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		hoverIndex = Math.round(frac * (count - 1));
	}

	function onPointerLeave() {
		hoverIndex = null;
	}

	const hoverX = $derived(hoverIndex != null && count > 1 ? (hoverIndex / (count - 1)) * 100 : 0);
	const hoverPoint = $derived.by(() => {
		if (hoverIndex == null) return null;
		const idx = hoverIndex;
		return {
			ts: timestamps[idx] ?? timestamps[timestamps.length - 1] ?? 0,
			values: series
				.filter((s) => !hidden.has(s.key))
				.map((s) => ({
					label: s.label,
					color: s.color,
					value: s.values[idx] ?? 0
				}))
		};
	});
</script>

<div class="w-full" style="height: {height}px">
	{#if hasData}
		<div class="relative w-full h-full">
			<!-- y labels -->
			<span class="absolute top-0 left-1 text-[10px] leading-none text-[var(--color-text-subtle)] tabular-nums pointer-events-none">
				{yFormat(gridValue(0, leftDomain))}
			</span>
			<span class="absolute top-1/2 left-1 -translate-y-1/2 text-[10px] leading-none text-[var(--color-text-subtle)] tabular-nums pointer-events-none">
				{yFormat(gridValue(0.5, leftDomain))}
			</span>
			<span class="absolute bottom-0 left-1 text-[10px] leading-none text-[var(--color-text-subtle)] tabular-nums pointer-events-none">
				{yFormat(gridValue(1, leftDomain))}
			</span>
			{#if rightSeries.length > 0}
				<span class="absolute top-0 right-1 text-[10px] leading-none text-[var(--color-text-subtle)] tabular-nums pointer-events-none">
					{yFormat(gridValue(0, rightDomain))}
				</span>
			{/if}

			<!-- chart -->
			<div
				bind:this={container}
				class="absolute inset-0"
				onpointermove={onPointerMove}
				onpointerleave={onPointerLeave}
				role="img"
				aria-label={ariaLabel}
			>
				<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="w-full h-full block overflow-visible">
					{#each gridlines as y (y)}
						<line
							x1="0"
							y1={y}
							x2={W}
							y2={y}
							stroke="var(--color-border-subtle)"
							stroke-width="1"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
					{#each series.filter((s) => !hidden.has(s.key)) as s (s.key)}
						{@const domain = domainFor(s)}
						{@const area = buildAreaPath(s.values, W, H, domain, PAD)}
						{@const line = buildLinePath(s.values, W, H, domain, PAD)}
						{#if area}
							<path d={area} fill={s.color} fill-opacity="0.12" />
						{/if}
						<path
							d={line}
							fill="none"
							stroke={s.color}
							stroke-width="1.5"
							stroke-dasharray={s.dashed ? '6 4' : undefined}
							stroke-linejoin="round"
							stroke-linecap="round"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
				</svg>
				{#if hoverIndex != null}
					<div
						class="absolute top-0 bottom-0 w-px bg-[var(--color-border)] pointer-events-none"
						style="left: {hoverX}%"
					></div>
				{/if}
			</div>

			<!-- tooltip -->
			{#if hoverPoint}
				<div
					class="absolute z-20 pointer-events-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs shadow-lg"
					style="left: {Math.min(85, Math.max(0, hoverX))}%; top: 4px; transform: translateX(-50%)"
				>
					<p class="text-[var(--color-text-subtle)] mb-1">{xFormat(hoverPoint.ts)}</p>
					{#each hoverPoint.values as v (v.label)}
						<div class="flex items-center gap-2 whitespace-nowrap">
							<span class="w-2 h-2 rounded-full shrink-0" style="background: {v.color}"></span>
							<span class="text-[var(--color-text-muted)]">{v.label}</span>
							<span class="ml-auto tabular-nums text-[var(--color-text)]">{yFormat(v.value)}</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- x labels -->
			<div class="absolute -bottom-4 inset-x-0 flex justify-between text-[10px] text-[var(--color-text-subtle)] tabular-nums pointer-events-none">
				<span>{xFormat(timestamps[0] ?? 0)}</span>
				{#if timestamps.length > 2}
					<span>{xFormat(timestamps[Math.floor(timestamps.length / 2)] ?? 0)}</span>
				{/if}
				<span>{xFormat(timestamps[timestamps.length - 1] ?? 0)}</span>
			</div>

			<!-- legend -->
			{#if legend}
				<div class="absolute -top-1 right-0 flex items-center gap-3">
					{#each series as s (s.key)}
						<button
							type="button"
							class="flex items-center gap-1.5 text-[11px] {hidden.has(s.key)
								? 'text-[var(--color-text-subtle)] opacity-50'
								: 'text-[var(--color-text-muted)]'} hover:opacity-100 transition-opacity"
							onclick={() => toggle(s.key)}
						>
							<span
								class="w-2.5 h-0.5 rounded-full {s.dashed ? 'border-t border-dashed' : ''}"
								style="background: {s.dashed ? 'transparent' : s.color}; border-color: {s.color}"
							></span>
							{s.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<div class="flex items-center justify-center h-full text-[var(--color-text-subtle)] text-sm">
			Waiting for data…
		</div>
	{/if}
</div>

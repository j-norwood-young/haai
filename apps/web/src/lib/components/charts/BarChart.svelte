<script lang="ts">
	interface Bucket {
		t: number;
		value: number;
		secondary?: number;
	}

	interface Props {
		buckets: Bucket[];
		color?: string;
		height?: number;
		yFormat?: (n: number) => string;
		xFormat?: (ts: number) => string;
		tooltip?: (bucket: Bucket) => string;
		onselect?: (bucket: Bucket) => void;
		ariaLabel?: string;
	}

	let {
		buckets,
		color = 'var(--color-brand)',
		height = 140,
		yFormat = (n) => String(n),
		xFormat = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
		tooltip,
		onselect,
		ariaLabel = 'bar chart'
	}: Props = $props();

	const W = 1000;
	const H = 100;
	const PAD = 4;

	let hoverIndex = $state<number | null>(null);

	const maxValue = $derived(Math.max(1, ...buckets.map((b) => Math.max(b.value, b.secondary ?? 0))));

	function barHeight(value: number): number {
		const frac = value / maxValue;
		return Math.max(frac > 0 ? 1.5 : 0, frac * (H - PAD * 2));
	}

	function barY(value: number): number {
		return H - PAD - barHeight(value);
	}
</script>

<div class="w-full" style="height: {height}px">
	{#if buckets.length > 0}
		<div class="relative w-full h-full">
			<span class="absolute top-0 left-1 text-[10px] leading-none text-[var(--color-text-subtle)] tabular-nums pointer-events-none z-10">
				{yFormat(maxValue)}
			</span>
			<svg
				viewBox="0 0 {W} {H}"
				preserveAspectRatio="none"
				class="w-full h-full block overflow-visible"
				role="img"
				aria-label={ariaLabel}
			>
				<line
					x1="0"
					y1={H - PAD}
					x2={W}
					y2={H - PAD}
					stroke="var(--color-border-subtle)"
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				/>
				{#each buckets as bucket, i (bucket.t)}
					{@const barW = W / buckets.length}
					<rect
						x={i * barW + barW * 0.15}
						y={barY(bucket.value)}
						width={barW * 0.7}
						height={barHeight(bucket.value)}
						fill={color}
						fill-opacity={hoverIndex === i ? 1 : 0.7}
						rx="1"
					/>
					{#if (bucket.secondary ?? 0) > 0}
						<rect
							x={i * barW + barW * 0.3}
							y={barY(bucket.secondary ?? 0)}
							width={barW * 0.4}
							height={barHeight(bucket.secondary ?? 0)}
							fill="var(--color-error)"
							rx="1"
						/>
					{/if}
				{/each}
			</svg>
			<!-- hover hit areas -->
			<div class="absolute inset-0 flex">
				{#each buckets as bucket, i (bucket.t)}
					<div
						class="flex-1 relative group"
						onpointerenter={() => (hoverIndex = i)}
						onpointerleave={() => (hoverIndex = null)}
						onclick={() => onselect?.(bucket)}
						role={onselect ? 'button' : undefined}
						tabindex={onselect ? 0 : undefined}
						onkeydown={(e) => {
							if (onselect && (e.key === 'Enter' || e.key === ' ')) onselect(bucket);
						}}
					>
						{#if hoverIndex === i}
							<div
								class="absolute z-20 bottom-full mb-1 left-1/2 -translate-x-1/2 pointer-events-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs shadow-lg whitespace-nowrap"
							>
								<p class="text-[var(--color-text-subtle)]">{xFormat(bucket.t)}</p>
								{#if tooltip}
									<p class="text-[var(--color-text)]">{tooltip(bucket)}</p>
								{:else}
									<p class="text-[var(--color-text)]">{yFormat(bucket.value)}</p>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="absolute -bottom-4 inset-x-0 flex justify-between text-[10px] text-[var(--color-text-subtle)] tabular-nums pointer-events-none">
				<span>{xFormat(buckets[0]!.t)}</span>
				{#if buckets.length > 2}
					<span>{xFormat(buckets[Math.floor(buckets.length / 2)]!.t)}</span>
				{/if}
				<span>{xFormat(buckets[buckets.length - 1]!.t)}</span>
			</div>
		</div>
	{:else}
		<div class="flex items-center justify-center h-full text-[var(--color-text-subtle)] text-sm">
			No data
		</div>
	{/if}
</div>

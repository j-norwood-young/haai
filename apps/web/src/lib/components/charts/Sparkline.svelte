<script lang="ts">
	import { buildAreaPath, buildLinePath, computeDomain } from './path.js';

	interface Props {
		values: number[];
		color?: string;
		height?: number;
		fill?: boolean;
		strokeWidth?: number;
		/** Draw a dashed reference line at this value */
		baseline?: number;
		ariaLabel?: string;
	}

	let {
		values,
		color = 'var(--color-brand)',
		height = 28,
		fill = true,
		strokeWidth = 1.5,
		baseline,
		ariaLabel = 'sparkline'
	}: Props = $props();

	const W = 100;
	const H = 100;

	const domain = $derived(computeDomain(baseline != null ? [...values, baseline] : values));
	const linePath = $derived(buildLinePath(values, W, H, domain, 4));
	const areaPath = $derived(buildAreaPath(values, W, H, domain, 4));
	const baselineY = $derived(
		baseline != null ? buildLinePath([baseline, baseline], W, H, domain, 4) : ''
	);
	const gradientId = $props.id();
</script>

<svg
	viewBox="0 0 {W} {H}"
	preserveAspectRatio="none"
	style="height: {height}px"
	class="w-full block overflow-visible"
	role="img"
	aria-label={ariaLabel}
>
	<defs>
		<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color={color} stop-opacity="0.35" />
			<stop offset="100%" stop-color={color} stop-opacity="0.02" />
		</linearGradient>
	</defs>
	{#if fill && areaPath}
		<path d={areaPath} fill="url(#{gradientId})" />
	{/if}
	{#if baseline != null && baselineY}
		<path
			d={baselineY}
			fill="none"
			stroke="currentColor"
			class="text-[var(--color-text-subtle)]"
			stroke-width={strokeWidth}
			stroke-dasharray="4 3"
			vector-effect="non-scaling-stroke"
		/>
	{/if}
	<path
		d={linePath}
		fill="none"
		stroke={color}
		stroke-width={strokeWidth}
		stroke-linejoin="round"
		stroke-linecap="round"
		vector-effect="non-scaling-stroke"
	/>
</svg>

<script lang="ts">
	interface Props {
		status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
		pulse?: boolean;
	}

	let { status, pulse = false }: Props = $props();

	const dotClass = $derived(
		status === 'healthy'
			? 'health-dot--green'
			: status === 'degraded'
				? 'health-dot--orange'
				: status === 'unhealthy'
					? 'health-dot--red'
					: 'health-dot--gray'
	);
</script>

<span class="relative inline-block w-2.5 h-2.5 shrink-0 align-middle" role="img" aria-label={status}>
	{#if pulse}
		<span class="health-dot {dotClass} cursor-default absolute inset-0 animate-ping"></span>
	{/if}
	<span class="health-dot {dotClass} cursor-default relative"></span>
</span>

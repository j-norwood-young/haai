<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		parentHref?: string;
		parentLabel?: string;
		actions?: Snippet;
	}

	let { title, subtitle, parentHref, parentLabel, actions }: Props = $props();
</script>

<div class="flex items-center justify-between mb-6">
	<div>
		{#if parentHref && parentLabel}
			<div class="flex items-center gap-3 mb-1">
				<a
					href={parentHref}
					class="flex items-center gap-1 text-sm text-(--color-text-muted) hover:text-(--color-text) transition-colors"
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M15.75 19.5 8.25 12l7.5-7.5"/>
					</svg>
					{parentLabel}
				</a>
			</div>
		{/if}
		<h1 class="text-2xl font-bold text-(--color-text)">{title}</h1>
		{#if subtitle}
			<p class="text-sm text-(--color-text-muted) mt-1">{subtitle}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex gap-2">
			{@render actions()}
		</div>
	{/if}
</div>

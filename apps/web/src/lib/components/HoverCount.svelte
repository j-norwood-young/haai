<script lang="ts">
	import HoverList from '$lib/components/HoverList.svelte';
	import type { HoverListItem } from '$lib/components/HoverList.svelte';

	/** A count of related items; hovering (or focusing) the number lists them. */
	interface Props {
		heading: string;
		items: HoverListItem[];
	}

	let { heading, items }: Props = $props();
</script>

{#if items.length > 0}
	<HoverList {heading} {items}>
		<span class="cursor-default underline decoration-dotted decoration-gray-600 underline-offset-4">
			{items.length}
		</span>
	</HoverList>
{:else}
	0
{/if}

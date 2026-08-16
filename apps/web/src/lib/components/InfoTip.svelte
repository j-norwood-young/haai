<script lang="ts">
	import { portal } from '$lib/portal.js';

	interface Props {
		text: string;
		label?: string;
	}

	const { text, label = 'More information' }: Props = $props();

	let anchor = $state<HTMLButtonElement | null>(null);
	let open = $state(false);
	let top = $state(0);
	let left = $state(0);

	function position() {
		if (!anchor) return;
		const rect = anchor.getBoundingClientRect();
		top = rect.bottom + 8;
		left = rect.left + rect.width / 2;
	}

	function show() {
		position();
		open = true;
	}

	function hide() {
		open = false;
	}
</script>

<svelte:window onscroll={hide} onresize={position} />

<span class="inline-flex">
	<button
		bind:this={anchor}
		type="button"
		class="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-600 text-[10px] font-semibold leading-none text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
		aria-label={label}
		onmouseenter={show}
		onmouseleave={hide}
		onfocus={show}
		onblur={hide}
	>
		?
	</button>
</span>

{#if open}
	<span
		use:portal
		role="tooltip"
		class="pointer-events-none fixed z-[9999] w-64 -translate-x-1/2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-left text-xs font-normal leading-relaxed text-gray-300 shadow-lg"
		style="top: {top}px; left: {left}px;"
	>
		{text}
	</span>
{/if}

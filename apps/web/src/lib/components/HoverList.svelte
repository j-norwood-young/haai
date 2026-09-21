<script lang="ts" module>
	import type { HoverListItem } from '$lib/hover-list.js';
	export type { HoverListItem };
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		heading: string;
		items: HoverListItem[];
		children: Snippet;
	}

	let { heading, items, children }: Props = $props();

	const popoverId = `hover-list-${Math.random().toString(36).slice(2, 10)}`;

	let trigger = $state<HTMLElement | null>(null);
	let open = $state(false);
	let top = $state(0);
	let left = $state(0);

	const POPOVER_MAX_WIDTH = 320; // keep in step with max-w-xs
	const GAP = 6;
	const VIEWPORT_MARGIN = 8;

	function show() {
		if (!trigger || items.length === 0) return;
		const rect = trigger.getBoundingClientRect();
		// Fixed positioning, so the table container's overflow can't clip the popover.
		left = Math.max(
			VIEWPORT_MARGIN,
			Math.min(rect.left, window.innerWidth - POPOVER_MAX_WIDTH - VIEWPORT_MARGIN)
		);
		top = rect.bottom + GAP;
		open = true;
	}

	function hide() {
		open = false;
	}
</script>

<svelte:window onscrollcapture={hide} onresize={hide} />

<span
	bind:this={trigger}
	class="inline-flex"
	role="presentation"
	onmouseenter={show}
	onmouseleave={hide}
	onfocusin={show}
	onfocusout={hide}
>
	<!-- Focusable so keyboard users can reach the popover, which is otherwise hover-only. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<span tabindex={items.length > 0 ? 0 : undefined} aria-describedby={open ? popoverId : undefined}>
		{@render children()}
	</span>
</span>

{#if open}
	<div
		id={popoverId}
		role="tooltip"
		class="fixed z-60 min-w-48 max-w-xs rounded-lg border border-(--color-border) bg-(--color-surface-2) text-xs shadow-2xl pointer-events-none"
		style="top: {top}px; left: {left}px"
	>
		<p
			class="px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wider text-(--color-text-subtle) border-b border-(--color-border-subtle)"
		>
			{heading}
		</p>
		<ul class="py-1.5">
			{#each items as item, i (i)}
				<li class="flex items-baseline gap-2 px-3 py-1" class:opacity-60={item.inactive}>
					<span class="text-(--color-text) truncate">{item.label}</span>
					{#if item.detail}
						<span class="font-mono text-(--color-text-muted) truncate">{item.detail}</span>
					{/if}
					{#if item.note}
						<span class="ml-auto shrink-0 text-amber-400">{item.note}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

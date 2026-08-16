<script lang="ts">
	import type { Snippet } from 'svelte';
	import { portal } from '$lib/portal.js';

	interface Props {
		open: boolean;
		title: string;
		onclose: () => void;
		children?: Snippet;
		footer?: Snippet;
	}

	let { open, title, onclose, children, footer }: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	$effect(() => {
		if (!open) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = previousOverflow;
		};
	});
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
	<div
		use:portal
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
		onclick={handleBackdropClick}
		role="presentation"
	>
		<div
			class="flex max-h-full w-full max-w-lg flex-col overflow-hidden bg-gray-900 border border-gray-700 rounded-xl shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
		>
			<div class="flex shrink-0 items-center justify-between px-5 py-4 border-b border-gray-800">
				<h2 id="modal-title" class="text-sm font-semibold text-gray-100">{title}</h2>
				<button
					type="button"
					onclick={onclose}
					class="p-1 text-gray-400 hover:text-gray-200 rounded-md transition-colors"
					aria-label="Close"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="min-h-0 overflow-y-auto px-5 py-4">
				{#if children}
					{@render children()}
				{/if}
			</div>

			{#if footer}
				<div class="flex shrink-0 items-center justify-end gap-2 px-5 py-4 border-t border-gray-800">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}

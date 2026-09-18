<script lang="ts">
	interface Props {
		/** Whether the live event stream to the server is currently open. */
		connected: boolean;
		/** How long the stream may stay down before the warning is shown. */
		graceMs?: number;
	}

	let { connected, graceMs = 3000 }: Props = $props();

	// `connected` is false during the initial connect and during the short
	// reconnects that follow a restart, so hold off until the outage outlasts
	// the grace window — and clear the warning the moment the stream is back.
	let visible = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function clearTimer() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
			return true;
		}
		return false;
	}

	$effect(() => {
		clearTimer();
		if (connected) {
			visible = false;
			return;
		}
		timer = setTimeout(() => {
			timer = null;
			visible = true;
		}, graceMs);
		return clearTimer;
	});
</script>

{#if visible}
	<div
		class="fixed top-16 right-3 z-30 flex w-72 max-w-[calc(100vw-1.5rem)] items-start gap-2.5 rounded-lg border border-amber-500/40 bg-[var(--color-surface-3)] p-3 shadow-lg md:top-4 md:right-4"
		role="status"
		aria-live="polite"
		data-testid="connection-warning"
	>
		<svg
			class="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path
				d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
			/>
		</svg>
		<div class="min-w-0">
			<p class="text-sm font-medium text-[var(--color-text)]">Server disconnected</p>
			<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
				Live updates paused. Trying to reconnect…
			</p>
		</div>
	</div>
{/if}

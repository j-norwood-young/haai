<script lang="ts">
	import BrandLogo from './BrandLogo.svelte';

	interface Props {
		message?: string;
	}

	const { message = 'Connecting to HAAI…' }: Props = $props();
</script>

<div class="loader" role="status" aria-live="polite">
	<!-- Decorative background -->
	<div class="loader__bg" aria-hidden="true">
		<div class="loader__glow loader__glow--cyan"></div>
		<div class="loader__glow loader__glow--violet"></div>
	</div>

	<div class="loader__inner">
		<BrandLogo variant="full" class="loader__logo" />
		<span class="sr-only">HAAI</span>

		<p class="loader__tagline">High Availability AI · OpenAI-compatible LLM proxy</p>

		<div class="loader__bar" aria-hidden="true">
			<div class="loader__bar-fill"></div>
		</div>

		<p class="loader__status">
			{message}<span class="loader__cursor" aria-hidden="true">▋</span>
		</p>
	</div>
</div>

<style>
	.loader {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: var(--color-surface);
		overflow: hidden;
	}

	.loader__bg {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.loader__glow {
		position: absolute;
		width: 24rem;
		height: 24rem;
		border-radius: 9999px;
		filter: blur(96px);
	}
	.loader__glow--cyan {
		top: -10rem;
		right: -10rem;
		background: rgba(34, 211, 238, 0.07);
	}
	.loader__glow--violet {
		bottom: -10rem;
		left: -10rem;
		background: rgba(139, 92, 246, 0.07);
	}

	.loader__inner {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25rem;
		text-align: center;
	}

	.loader__inner :global(.loader__logo) {
		height: clamp(2.5rem, 8vw, 4rem);
		max-width: min(20rem, 80vw);
		width: auto;
		color: var(--color-brand);
		filter: drop-shadow(0 0 18px var(--color-brand-glow-strong));
		animation: loader-glow 2.4s ease-in-out infinite;
	}

	.loader__tagline {
		margin: 0;
		font-size: clamp(0.7rem, 1.6vw, 0.8rem);
		color: var(--color-text-muted);
		letter-spacing: 0.01em;
	}

	.loader__bar {
		position: relative;
		width: min(20rem, 70vw);
		height: 3px;
		border-radius: 9999px;
		background: var(--color-surface-3);
		overflow: hidden;
	}
	.loader__bar-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: 40%;
		border-radius: 9999px;
		background: linear-gradient(
			90deg,
			transparent,
			var(--color-brand-dark),
			var(--color-brand),
			var(--color-brand-dark),
			transparent
		);
		animation: loader-slide 1.4s ease-in-out infinite;
	}

	.loader__status {
		margin: 0;
		font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', Menlo,
			Consolas, monospace;
		font-size: 0.8rem;
		color: var(--color-text-subtle);
	}

	.loader__cursor {
		display: inline-block;
		margin-left: 0.15em;
		color: var(--color-brand);
		animation: loader-blink 1s steps(1) infinite;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@keyframes loader-glow {
		0%,
		100% {
			filter: drop-shadow(0 0 12px var(--color-brand-glow));
			opacity: 0.92;
		}
		50% {
			filter: drop-shadow(0 0 26px var(--color-brand-glow-strong));
			opacity: 1;
		}
	}

	@keyframes loader-slide {
		0% {
			left: -40%;
		}
		100% {
			left: 100%;
		}
	}

	@keyframes loader-blink {
		0%,
		50% {
			opacity: 1;
		}
		50.01%,
		100% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.loader__inner :global(.loader__logo),
		.loader__bar-fill,
		.loader__cursor {
			animation: none;
		}
		.loader__bar-fill {
			left: 0;
			width: 100%;
			opacity: 0.6;
		}
	}
</style>

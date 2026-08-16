<script lang="ts">
	import Modal from './Modal.svelte';
	import { api } from '$lib/api.js';
	import {
		hasHealthDetails,
		healthBadgeClass,
		type BackendHealthDetails
	} from '$lib/backend-health.js';

	interface Props {
		open: boolean;
		backend: BackendHealthDetails | null;
		onclose: () => void;
		/** Called after a successful retest so parents can refresh lists. */
		onupdated?: (result: {
			id: string;
			health: 'healthy' | 'degraded' | 'unhealthy';
			latency_ms?: number;
			error?: string;
		}) => void;
	}

	let { open, backend, onclose, onupdated }: Props = $props();

	let retesting = $state(false);
	let retestError = $state<string | null>(null);

	const title = $derived(backend ? `${backend.name} health` : 'Backend health');

	const checkedLabel = $derived.by(() => {
		if (!backend?.checked_at) return null;
		const date =
			typeof backend.checked_at === 'number'
				? new Date(backend.checked_at)
				: new Date(backend.checked_at);
		if (Number.isNaN(date.getTime())) return null;
		return date.toLocaleString();
	});

	const detailMessage = $derived.by(() => {
		if (!backend) return null;
		if (backend.error) return backend.error;
		if (backend.health === 'degraded' && backend.latency_ms != null) {
			return `High latency (${backend.latency_ms}ms)`;
		}
		if (backend.health === 'unhealthy') {
			return 'No error details recorded yet. Retest to capture the current failure.';
		}
		return null;
	});

	async function retest() {
		if (!backend || retesting) return;
		retesting = true;
		retestError = null;
		try {
			const result = await api.testBackend(backend.id);
			if (result.health) {
				const updated: {
					id: string;
					health: 'healthy' | 'degraded' | 'unhealthy';
					latency_ms?: number;
					error?: string;
				} = { id: backend.id, health: result.health };
				if (result.latency_ms !== undefined) updated.latency_ms = result.latency_ms;
				if (result.error) updated.error = result.error;
				onupdated?.(updated);

				if (!hasHealthDetails(result.health)) {
					onclose();
				}
			}
		} catch (err) {
			retestError = err instanceof Error ? err.message : 'Retest failed';
		} finally {
			retesting = false;
		}
	}
</script>

<Modal {open} {title} {onclose}>
	{#if backend}
		<div class="space-y-4 text-sm">
			<div class="flex flex-wrap items-center gap-2">
				<span class="capitalize {healthBadgeClass(backend.health)}">{backend.health}</span>
				{#if backend.latency_ms != null}
					<span class="text-gray-400">{backend.latency_ms}ms</span>
				{/if}
			</div>

			{#if backend.url}
				<div>
					<p class="text-xs uppercase tracking-wide text-gray-500 mb-1">URL</p>
					<p class="font-mono text-xs text-gray-300 break-all">{backend.url}</p>
				</div>
			{/if}

			{#if checkedLabel}
				<div>
					<p class="text-xs uppercase tracking-wide text-gray-500 mb-1">Last checked</p>
					<p class="text-gray-300">{checkedLabel}</p>
				</div>
			{/if}

			{#if detailMessage}
				<div>
					<p class="text-xs uppercase tracking-wide text-gray-500 mb-1">Details</p>
					<pre
						class="whitespace-pre-wrap break-words rounded-lg bg-black/40 border border-gray-800 px-3 py-2 text-xs text-red-300 font-mono"
					>{detailMessage}</pre>
				</div>
			{/if}

			{#if retestError}
				<p class="text-xs text-red-400">{retestError}</p>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-sm btn-secondary" onclick={onclose}>Close</button>
		<button
			type="button"
			class="btn btn-sm btn-primary"
			onclick={retest}
			disabled={!backend || retesting}
		>
			{retesting ? 'Testing…' : 'Retest'}
		</button>
	{/snippet}
</Modal>

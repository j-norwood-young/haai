<script lang="ts">
	import Modal from './Modal.svelte';
	import { api } from '$lib/api.js';
	import type { AvailableModel, Backend } from '$lib/api.js';
	import { rawBackendModelId } from '$lib/model-ids.js';

	interface Props {
		open: boolean;
		backend: Pick<Backend, 'id' | 'name' | 'host' | 'provider'> | null;
		onclose: () => void;
	}

	let { open, backend, onclose }: Props = $props();

	let models = $state<AvailableModel[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let fetchGeneration = 0;

	const title = $derived(backend ? `${backend.name} models` : 'Models');

	async function loadModels(target: Pick<Backend, 'id' | 'name' | 'host' | 'provider'>) {
		const generation = ++fetchGeneration;
		loading = true;
		error = null;
		try {
			const res = await api.getAvailableModels();
			if (generation !== fetchGeneration) return;
			models = res.models
				.filter((m) => m.type === 'backend-model' && m.backendId === target.id)
				.sort((a, b) =>
					rawBackendModelId(a.id, target).localeCompare(rawBackendModelId(b.id, target))
				);
		} catch (err) {
			if (generation !== fetchGeneration) return;
			error = err instanceof Error ? err.message : 'Failed to load models';
			models = [];
		} finally {
			if (generation === fetchGeneration) loading = false;
		}
	}

	function refresh() {
		if (!backend || loading) return;
		void loadModels(backend);
	}

	$effect(() => {
		const isOpen = open;
		const backendId = backend?.id;
		if (!isOpen || !backendId || !backend) {
			fetchGeneration += 1;
			models = [];
			loading = false;
			error = null;
			return;
		}
		void loadModels(backend);
	});
</script>

<Modal {open} {title} {onclose}>
	{#if backend}
		<div class="space-y-4 text-sm">
			<div>
				<p class="text-[var(--color-text-muted)] text-xs uppercase tracking-wider mb-2">
					Available models
				</p>

				{#if loading}
					<p class="text-[var(--color-text-subtle)] py-6 text-center">Loading models…</p>
				{:else if error}
					<div
						class="rounded-lg bg-red-900/20 border border-red-800/50 px-3 py-2 text-red-300 text-sm"
					>
						{error}
					</div>
				{:else if models.length === 0}
					<p class="text-[var(--color-text-subtle)]">
						No models found. Ensure the backend is enabled and reachable, then try Refresh.
					</p>
				{:else}
					<ul class="space-y-2 max-h-[60vh] overflow-y-auto">
						{#each models as model (model.id)}
							<li
								class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3 py-2"
							>
								<p class="text-[var(--color-text)] font-mono text-sm break-all">
									{rawBackendModelId(model.id, backend)}
								</p>
								<p class="text-xs text-[var(--color-text-subtle)] font-mono break-all mt-0.5">
									{model.id}
								</p>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-sm btn-secondary" onclick={onclose}>Close</button>
		<button
			type="button"
			class="btn btn-sm btn-primary"
			onclick={refresh}
			disabled={!backend || loading}
		>
			{loading ? 'Refreshing…' : 'Refresh'}
		</button>
	{/snippet}
</Modal>

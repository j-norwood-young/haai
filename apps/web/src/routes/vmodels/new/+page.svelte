<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api.js';
	import type { Backend, VModel, VModelCreateInput } from '$lib/api.js';
	import { rawBackendModelId } from '$lib/model-ids.js';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let backends = $state<Backend[]>([]);
	let loading = $state(true);
	let createLoading = $state(false);
	let error = $state<string | null>(null);
	let createError = $state<string | null>(null);

	let modelId = $state('');
	let displayName = $state('');
	let strategy = $state<VModel['strategy']>('session-pin');
	let streaming = $state(true);
	let selectedBackendIds = $state<string[]>([]);
	let backendModels = $state<Record<string, string>>({}); // Maps backendId -> backendModelId

	// Available models grouped by backend for dropdowns
	let availableModelsByBackend = $state<Record<string, Array<{ id: string; name: string }>>>({});

	const allSelectedBackendsHaveModels = $derived(
		selectedBackendIds.length > 0 &&
			selectedBackendIds.every((backendId) => Boolean(backendModels[backendId]))
	);

	async function load() {
		try {
			backends = await api.getBackends();
			selectedBackendIds = backends.map((b) => b.id);

			// Fetch available models from all backends
			const result = await api.getAvailableModels();

			// Group models by backend ID using raw upstream model IDs
			const grouped: Record<string, Array<{ id: string; name: string }>> = {};
			const backendsById = new Map(backends.map((b) => [b.id, b]));
			for (const model of result.models ?? []) {
				if (model.type === 'backend-model' && model.backendId) {
					const backendId = model.backendId;
					const backend = backendsById.get(backendId);
					const rawId = rawBackendModelId(model.id, backend);
					if (!grouped[backendId]) {
						grouped[backendId] = [];
					}
					grouped[backendId].push({
						id: rawId,
						name: `${rawId} (${model.backendName || model.ownedBy})`
					});
				}
			}
			availableModelsByBackend = grouped;

			// Initialize backend model selections as unset
			const nextModels: Record<string, string> = {};
			for (const b of backends) {
				nextModels[b.id] = '';
			}
			backendModels = nextModels;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load backends';
		} finally {
			loading = false;
		}
	}

	function toggleBackend(backendId: string, selected: boolean) {
		if (selected) {
			if (!selectedBackendIds.includes(backendId)) {
				selectedBackendIds = [...selectedBackendIds, backendId];
				if (!(backendId in backendModels)) {
					backendModels[backendId] = '';
				}
			}
		} else {
			selectedBackendIds = selectedBackendIds.filter((id) => id !== backendId);
			delete backendModels[backendId];
		}
	}

	function updateBackendModel(backendId: string, value: string) {
		backendModels[backendId] = value;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		createLoading = true;
		createError = null;
		try {
			if (
				selectedBackendIds.length === 0 ||
				selectedBackendIds.some((backendId) => !backendModels[backendId])
			) {
				createError = 'Select a backend model for each selected backend';
				return;
			}
			const mappedBackends: NonNullable<VModelCreateInput['backends']> = [];
			for (const backendId of selectedBackendIds) {
				const backendModelId = backendModels[backendId];
				if (!backendModelId) {
					createError = 'Select a backend model for each selected backend';
					return;
				}
				mappedBackends.push({
					backend_id: backendId,
					backend_model_id: backendModelId
				});
			}
			const payload: VModelCreateInput = {
				model_id: modelId,
				display_name: displayName,
				strategy,
				streaming,
				backends: mappedBackends
			};
			await api.createVModel(payload);
			goto('/vmodels');
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Failed to create virtual model';
		} finally {
			createLoading = false;
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>New Virtual Model — HAAI</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
	<PageHeader
		title="New Virtual Model"
		subtitle="Route a model ID to a backend pool"
		parentHref="/vmodels"
		parentLabel="Virtual Models"
	/>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm mb-4">
			{error}
		</div>
	{:else if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else}
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<form onsubmit={handleSubmit} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label for="new-model-id" class="block text-xs font-medium text-gray-400 mb-1">Model ID *</label>
					<input id="new-model-id" bind:value={modelId} required placeholder="gpt-4o" class="input w-full" />
				</div>
				<div>
					<label for="new-display-name" class="block text-xs font-medium text-gray-400 mb-1">Display Name *</label>
					<input id="new-display-name" bind:value={displayName} required placeholder="GPT-4o" class="input w-full" />
				</div>
				<div>
					<label for="new-strategy" class="block text-xs font-medium text-gray-400 mb-1">Strategy</label>
					<select id="new-strategy" bind:value={strategy} class="input w-full">
						<option value="session-pin">Session Pin</option>
						<option value="round-robin">Round Robin</option>
						<option value="weighted">Weighted</option>
						<option value="least-connections">Least Connections</option>
						<option value="least-latency">Least Latency</option>
					</select>
				</div>
				<div class="flex items-center gap-3 pt-5">
					<button
						type="button"
						onclick={() => (streaming = !streaming)}
						class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
						class:bg-cyan-500={streaming}
						class:bg-gray-700={!streaming}
						role="switch"
						aria-checked={streaming}
						aria-label="Enable Streaming"
					>
						<span
							class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
							class:translate-x-4={streaming}
							class:translate-x-0={!streaming}
						></span>
					</button>
					<span class="text-sm text-gray-300">Enable Streaming</span>
				</div>

				<div class="sm:col-span-2">
					<div class="flex items-center justify-between mb-2">
						<span class="text-xs font-medium text-gray-400">Backends</span>
						{#if backends.length > 0}
							<span class="text-xs text-gray-500">
								{selectedBackendIds.length} of {backends.length} selected
							</span>
						{/if}
					</div>
					{#if backends.length === 0}
						<p class="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2">
							No backends configured. <a href="/backends/new" class="text-cyan-400 hover:text-cyan-300">Add a backend</a> first.
						</p>
					{:else}
						<div class="space-y-2 rounded-lg border border-gray-800 bg-gray-800/30 p-3 max-h-48 overflow-y-auto">
							{#each backends as b (b.id)}
								<label class="flex items-start gap-3 cursor-pointer rounded-md px-2 py-1.5 hover:bg-gray-800/60 block w-full">
									<input
										type="checkbox"
										checked={selectedBackendIds.includes(b.id)}
										onchange={(e) => toggleBackend(b.id, e.currentTarget.checked)}
										class="checkbox mt-1"
									/>
									<div class="flex-1 min-w-0">
										<span class="text-sm text-gray-200 block">{b.name}</span>
										{#if selectedBackendIds.includes(b.id)}
											<select
												bind:value={backendModels[b.id]}
												oninput={(e) => updateBackendModel(b.id, e.currentTarget.value)}
												class="mt-1 w-full text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-300"
											>
												<option value="" disabled>Select model…</option>
												{#if ((availableModelsByBackend[b.id] ?? [])?.length ?? 0) > 0}
													{#each (availableModelsByBackend[b.id] ?? []) as m (m.id)}
														<option value={m.id}>{m.name}</option>
													{/each}
												{:else}
													<optgroup label="No models discovered">
														<option value="" disabled>— No models found —</option>
													</optgroup>
												{/if}
											</select>
										{/if}
									</div>
									<span class="text-xs text-gray-500">{b.provider}</span>
								</label>
							{/each}
						</div>
					{/if}
				</div>

				{#if createError}
					<div class="sm:col-span-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
						{createError}
					</div>
				{/if}
				<div class="sm:col-span-2 flex gap-3">
					<button
						type="submit"
						disabled={createLoading || backends.length === 0 || !allSelectedBackendsHaveModels}
						class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors"
					>
						{createLoading ? 'Creating…' : 'Create'}
					</button>
					<a
						href="/vmodels"
						class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors"
					>
						Cancel
					</a>
				</div>
			</form>
		</div>
	{/if}
</div>

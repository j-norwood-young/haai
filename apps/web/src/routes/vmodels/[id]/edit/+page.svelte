<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api.js';
	import type { Backend, VModel } from '$lib/api.js';
	import { rawBackendModelId } from '$lib/model-ids.js';
	import PageHeader from '$lib/components/PageHeader.svelte';

	const id = $derived(page.params.id!);

	let vmodel = $state<VModel | null>(null);
	let backends = $state<Backend[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let saveError = $state<string | null>(null);

	let displayName = $state('');
	let strategy = $state<VModel['strategy']>('session-pin');
	let streaming = $state(true);
	let enabled = $state(true);

	let addBackendId = $state('');
	let addBackendLoading = $state(false);
	let newBackendModelId = $state(''); // For specifying backend model when adding
	let addBackendWeight = $state<string>('1'); // Weight for new backend mapping
	let editingWeightFor = $state<string | null>(null); // Backend mapping ID being edited
	let tempWeight = $state<string>('1'); // Temporary weight input

	// Available models grouped by backend for dropdowns
	let availableModelsByBackend = $state<Record<string, Array<{ id: string; name: string }>>>({});

	async function load() {
		loading = true;
		error = null;
		try {
			[vmodel, backends] = await Promise.all([api.getVModel(id), api.getBackends()]);

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

			displayName = vmodel.display_name;
			strategy = vmodel.strategy;
			streaming = vmodel.streaming;
			enabled = vmodel.enabled;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load virtual model';
		} finally {
			loading = false;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		saveError = null;
		try {
			await api.updateVModel(id, { display_name: displayName, strategy, streaming, enabled });
			goto('/vmodels');
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to update virtual model';
		} finally {
			saving = false;
		}
	}

	async function handleAddBackend() {
		if (!addBackendId || !newBackendModelId || !vmodel) return;
		addBackendLoading = true;
		try {
			await api.addVModelBackend(id, {
				backend_id: addBackendId,
				backend_model_id: newBackendModelId,
				weight: parseInt(addBackendWeight, 10)
			});
			vmodel = await api.getVModel(id);
			addBackendId = '';
			newBackendModelId = '';
			addBackendWeight = '1'; // Reset weight after adding
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to add backend';
		} finally {
			addBackendLoading = false;
		}
	}

	async function handleRemoveBackend(backendMappingId: string) {
		try {
			await api.removeVModelBackend(id, backendMappingId);
			if (vmodel) {
				vmodel = {
					...vmodel,
					backends: vmodel.backends.filter((b) => b.id !== backendMappingId)
				};
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to remove backend';
		}
	}

	function backendName(backendId: string): string {
		return backends.find((b) => b.id === backendId)?.name ?? backendId;
	}

	async function handleUpdateWeight(mappingId: string, weight: number) {
		if (!vmodel || !mappingId) return;
		try {
			await api.updateVModelBackendWeight(vmodel.id, mappingId, weight);
			vmodel = await api.getVModel(vmodel.id);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to update weight';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Edit Virtual Model — AiVM</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
	<PageHeader
		title="Edit Virtual Model"
		subtitle={vmodel?.model_id ?? ''}
		parentHref="/vmodels"
		parentLabel="Virtual Models"
	/>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm mb-4">
			{error}
		</div>
	{:else if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if vmodel}
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-6">
			<form onsubmit={handleSubmit} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label for="edit-model-id" class="block text-xs font-medium text-gray-400 mb-1">Model ID</label>
					<input id="edit-model-id" value={vmodel.model_id} disabled class="input w-full opacity-60 cursor-not-allowed font-mono" />
				</div>
				<div>
					<label for="edit-display-name" class="block text-xs font-medium text-gray-400 mb-1">Display Name</label>
					<input id="edit-display-name" bind:value={displayName} required class="input w-full" />
				</div>
				<div>
					<label for="edit-strategy" class="block text-xs font-medium text-gray-400 mb-1">Strategy</label>
					<select id="edit-strategy" bind:value={strategy} class="input w-full">
						<option value="session-pin">Session Pin</option>
						<option value="round-robin">Round Robin</option>
						<option value="weighted">Weighted</option>
						<option value="least-connections">Least Connections</option>
						<option value="least-latency">Least Latency</option>
					</select>
				</div>
				<div class="flex items-center gap-6 pt-5">
					<div class="flex items-center gap-3">
						<button
							type="button"
							onclick={() => (streaming = !streaming)}
							class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
							class:bg-cyan-500={streaming}
							class:bg-gray-700={!streaming}
							role="switch"
							aria-checked={streaming}
							aria-label="Streaming"
						>
							<span
								class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
								class:translate-x-4={streaming}
								class:translate-x-0={!streaming}
							></span>
						</button>
						<span class="text-sm text-gray-300">Streaming</span>
					</div>
					<div class="flex items-center gap-3">
						<button
							type="button"
							onclick={() => (enabled = !enabled)}
							class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
							class:bg-cyan-500={enabled}
							class:bg-gray-700={!enabled}
							role="switch"
							aria-checked={enabled}
							aria-label="Enabled"
						>
							<span
								class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
								class:translate-x-4={enabled}
								class:translate-x-0={!enabled}
							></span>
						</button>
						<span class="text-sm text-gray-300">Enabled</span>
					</div>
				</div>

				{#if saveError}
					<div class="sm:col-span-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
						{saveError}
					</div>
				{/if}

				<div class="sm:col-span-2 flex gap-3">
					<button
						type="submit"
						disabled={saving}
						class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors"
					>
						{saving ? 'Saving…' : 'Save Changes'}
					</button>
					<a
						href="/vmodels"
						class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors"
					>
						Cancel
					</a>
				</div>
			</form>

			<div class="border-t border-gray-800 pt-6">
				<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Backend Model Mappings</h2>
				{#if vmodel.backends.length === 0}
					<p class="text-sm text-gray-500 mb-3">No backends assigned.</p>
				{:else}
					<div class="space-y-1.5 mb-4">
						{#each vmodel.backends as b (b.id)}
							<div class="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
								<span class="text-sm text-gray-200 flex-1">{backendName(b.backend_id)}</span>
								<span class="text-xs text-gray-500 font-mono">{b.backend_model_id}</span>
								{#if editingWeightFor === b.id}
									<div class="flex items-center gap-2 shrink-0">
										<input
											type="number"
											bind:value={tempWeight}
											min="1"
											max="100"
											class="input !w-20 shrink-0 text-xs"
											placeholder="weight"
										/>
										<button
											type="button"
											onclick={() => {
												if (b.id) handleUpdateWeight(b.id, parseInt(tempWeight, 10));
												editingWeightFor = null;
												tempWeight = '1';
											}}
											class="text-xs text-green-400 hover:text-green-300"
										>
											Save
										</button>
										<button
											type="button"
											onclick={() => {
												editingWeightFor = null;
												tempWeight = '1';
											}}
											class="text-xs text-gray-500 hover:text-gray-400"
										>
											Cancel
										</button>
									</div>
								{:else}
									{#if b.weight != null}
										<span class="text-xs text-cyan-400 font-mono">weight: {b.weight}</span>
									{:else}
										<span class="text-xs text-gray-500 font-mono">weight: 1</span>
									{/if}
									<button
										type="button"
										onclick={() => {
											editingWeightFor = b.id;
											tempWeight = (b.weight ?? 1).toString();
										}}
										class="text-xs text-gray-500 hover:text-cyan-400 transition-colors"
									>
										Edit weight
									</button>
								{/if}
								<button
									type="button"
									onclick={() => handleRemoveBackend(b.id)}
									class="text-xs text-gray-500 hover:text-red-400 transition-colors"
								>
									Remove
								</button>
							</div>
						{/each}
					</div>
				{/if}
				<div
					class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_5rem_auto] gap-2 items-center"
				>
					<select
						bind:value={addBackendId}
						onchange={() => {
							newBackendModelId = '';
						}}
						class="input !w-full min-w-0 text-xs"
					>
						<option value="">Select backend…</option>
						{#each backends as b (b.id)}
							<option value={b.id}>{b.name}</option>
						{/each}
					</select>
					<select
						bind:value={newBackendModelId}
						class="input !w-full min-w-0 text-xs"
						disabled={!addBackendId}
					>
						<option value="" disabled>Select model…</option>
						{#if addBackendId && ((availableModelsByBackend[addBackendId] ?? [])?.length ?? 0) > 0}
							{#each (availableModelsByBackend[addBackendId] ?? []) as m (m.id)}
								<option value={m.id}>{m.name}</option>
							{/each}
						{:else if !vmodel || !addBackendId}
							<optgroup label="Select a backend first">
								<option disabled>Select a backend to see available models</option>
							</optgroup>
						{:else}
							<optgroup label="No models discovered">
								<option value="" disabled>— No models found —</option>
							</optgroup>
						{/if}
					</select>
					<input
						type="number"
						bind:value={addBackendWeight}
						min="0"
						max="100"
						class="input !w-full text-xs"
						placeholder="weight"
						aria-label="Weight"
					/>
					<button
						type="button"
						onclick={handleAddBackend}
						disabled={!addBackendId || !newBackendModelId || addBackendLoading}
						class="px-3 py-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white rounded-md transition-colors shrink-0 justify-self-start sm:justify-self-auto"
					>
						Add
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

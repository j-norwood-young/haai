<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api.js';
	import type {
		Backend,
		VModel,
		VModelBackend,
		VModelCreateInput
	} from '$lib/api.js';
	import { rawBackendModelId } from '$lib/model-ids.js';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ScopedPlugins from '$lib/components/ScopedPlugins.svelte';

	interface Props {
		/** Present when editing an existing v-model; absent when creating a new one. */
		vmodelId?: string;
	}

	let { vmodelId }: Props = $props();

	const isEdit = $derived(vmodelId !== undefined);

	type ModelOption = { id: string; name: string; modelKind: 'llm' | 'vlm' | 'embeddings' };

	// The saved v-model (edit only). Backend mappings are applied to the server as they are made.
	let vmodel = $state<VModel | null>(null);
	// Mappings queued locally until the v-model exists (create only).
	let draftBackends = $state<VModelBackend[]>([]);
	let draftSeq = 0;

	let backends = $state<Backend[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let saveError = $state<string | null>(null);

	let modelId = $state('');
	let displayName = $state('');
	let strategy = $state<VModel['strategy']>('session-pin');
	let kind = $state<VModel['kind']>('chat');
	let streaming = $state(true);
	let enabled = $state(true);

	let addBackendId = $state('');
	let addBackendLoading = $state(false);
	let newBackendModelId = $state('');
	let addBackendWeight = $state<string>('1');
	let editingWeightFor = $state<string | null>(null); // Backend mapping ID being edited
	let tempWeight = $state<string>('1');
	let dragSourceId = $state<string | null>(null);

	// Available models grouped by backend for dropdowns
	let availableModelsByBackend = $state<Record<string, ModelOption[]>>({});

	const members = $derived<VModelBackend[]>(isEdit ? (vmodel?.backends ?? []) : draftBackends);

	// Kind is immutable once a v-model has mapped backends (the server 409s otherwise).
	const kindLocked = $derived(members.length > 0);

	const mappedModelKeys = $derived(
		new Set(members.map((b) => `${b.backend_id}::${b.backend_model_id}`))
	);

	function matchesKind(m: ModelOption): boolean {
		// Only offer models matching this v-model's kind, so an embedding model
		// can't be mapped into a chat v-model (or vice versa).
		return kind === 'embedding' ? m.modelKind === 'embeddings' : m.modelKind !== 'embeddings';
	}

	const modelsForSelectedBackend = $derived(
		addBackendId
			? (availableModelsByBackend[addBackendId] ?? []).filter(
					(m) => matchesKind(m) && !mappedModelKeys.has(`${addBackendId}::${m.id}`)
				)
			: []
	);

	// A backend picked in the add row but not yet added still counts: submitting adds it first.
	const hasPendingMapping = $derived(Boolean(addBackendId && newBackendModelId));
	const canSubmit = $derived(members.length > 0 || hasPendingMapping);

	const hasMatchingModels = $derived(
		addBackendId ? (availableModelsByBackend[addBackendId] ?? []).some(matchesKind) : false
	);

	const sortedBackends = $derived(
		[...members].sort((a, b) => {
			const wA = a.weight ?? 1;
			const wB = b.weight ?? 1;
			if (wA !== wB) return wB - wA;
			const nameA = backendName(a.backend_id).toLowerCase();
			const nameB = backendName(b.backend_id).toLowerCase();
			if (nameA !== nameB) return nameA < nameB ? -1 : 1;
			const mA = a.backend_model_id.toLowerCase();
			const mB = b.backend_model_id.toLowerCase();
			return mA < mB ? -1 : mA > mB ? 1 : 0;
		})
	);

	function backendName(backendId: string): string {
		return backends.find((b) => b.id === backendId)?.name ?? backendId;
	}

	function parseWeight(value: string): number {
		const n = parseInt(value, 10);
		return Number.isFinite(n) && n >= 0 ? n : 1;
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const [existing, backendList, available] = await Promise.all([
				vmodelId ? api.getVModel(vmodelId) : Promise.resolve(null),
				api.getBackends(),
				api.getAvailableModels()
			]);
			backends = backendList;

			// Group models by backend ID using raw upstream model IDs
			const grouped: Record<string, ModelOption[]> = {};
			const backendsById = new Map(backends.map((b) => [b.id, b]));
			for (const model of available.models ?? []) {
				if (model.type === 'backend-model' && model.backendId) {
					const backendId = model.backendId;
					const rawId = rawBackendModelId(model.id, backendsById.get(backendId));
					(grouped[backendId] ??= []).push({
						id: rawId,
						name: `${rawId} (${model.backendName || model.ownedBy})`,
						modelKind: model.modelKind
					});
				}
			}
			availableModelsByBackend = grouped;

			if (existing) {
				vmodel = existing;
				modelId = existing.model_id;
				displayName = existing.display_name;
				strategy = existing.strategy;
				kind = existing.kind;
				streaming = existing.streaming;
				enabled = existing.enabled;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load virtual model';
		} finally {
			loading = false;
		}
	}

	async function refreshVModel() {
		if (vmodelId) vmodel = await api.getVModel(vmodelId);
	}

	/** Returns whether the mapping was added. */
	async function handleAddBackend(): Promise<boolean> {
		if (!addBackendId || !newBackendModelId) return false;
		addBackendLoading = true;
		saveError = null;
		try {
			const weight = parseWeight(addBackendWeight);
			if (vmodelId) {
				await api.addVModelBackend(vmodelId, {
					backend_id: addBackendId,
					backend_model_id: newBackendModelId,
					weight
				});
				await refreshVModel();
			} else {
				draftBackends = [
					...draftBackends,
					{
						id: `draft-${++draftSeq}`,
						backend_id: addBackendId,
						backend_model_id: newBackendModelId,
						weight
					}
				];
			}
			addBackendId = '';
			newBackendModelId = '';
			addBackendWeight = '1';
			return true;
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to add backend';
			return false;
		} finally {
			addBackendLoading = false;
		}
	}

	async function handleRemoveBackend(mappingId: string) {
		saveError = null;
		try {
			if (vmodelId) {
				await api.removeVModelBackend(vmodelId, mappingId);
				if (vmodel) {
					vmodel = { ...vmodel, backends: vmodel.backends.filter((b) => b.id !== mappingId) };
				}
			} else {
				draftBackends = draftBackends.filter((b) => b.id !== mappingId);
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to remove backend';
		}
	}

	async function handleUpdateWeight(mappingId: string, weight: number) {
		saveError = null;
		try {
			if (vmodelId) {
				await api.updateVModelBackendWeight(vmodelId, mappingId, weight);
				await refreshVModel();
			} else {
				draftBackends = draftBackends.map((b) => (b.id === mappingId ? { ...b, weight } : b));
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to update weight';
		}
	}

	function commitWeightEdit(mappingId: string) {
		void handleUpdateWeight(mappingId, parseWeight(tempWeight));
		editingWeightFor = null;
		tempWeight = '1';
	}

	function cancelWeightEdit() {
		editingWeightFor = null;
		tempWeight = '1';
	}

	async function handleDragDrop(targetId: string) {
		const sourceId = dragSourceId;
		dragSourceId = null;
		if (!sourceId || sourceId === targetId) return;
		const source = members.find((b) => b.id === sourceId);
		const target = members.find((b) => b.id === targetId);
		if (!source || !target) return;
		const sourceWeight = source.weight ?? 1;
		const targetWeight = target.weight ?? 1;
		if (sourceWeight === targetWeight) return;
		saveError = null;
		try {
			if (vmodelId) {
				await Promise.all([
					api.updateVModelBackendWeight(vmodelId, source.id, targetWeight),
					api.updateVModelBackendWeight(vmodelId, target.id, sourceWeight)
				]);
				await refreshVModel();
			} else {
				draftBackends = draftBackends.map((b) =>
					b.id === source.id
						? { ...b, weight: targetWeight }
						: b.id === target.id
							? { ...b, weight: sourceWeight }
							: b
				);
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to reorder backends';
		}
	}

	function handleKindChange(next: VModel['kind']) {
		kind = next;
		// A model picked for the previous kind may no longer be offered.
		newBackendModelId = '';
	}

	// Enter in a number field would otherwise submit the whole form.
	function handleWeightKeydown(e: KeyboardEvent, onEnter: () => void) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		onEnter();
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) {
			saveError = 'Add at least one backend model mapping';
			return;
		}
		saving = true;
		saveError = null;
		try {
			// Don't silently drop a backend the user picked but hasn't hit "Add" on yet.
			if (hasPendingMapping) {
				if (!(await handleAddBackend())) return;
			}
			if (vmodelId) {
				await api.updateVModel(vmodelId, {
					display_name: displayName,
					strategy,
					kind,
					streaming,
					enabled
				});
			} else {
				const payload: VModelCreateInput = {
					model_id: modelId,
					display_name: displayName,
					strategy,
					kind,
					streaming,
					enabled,
					backends: draftBackends.map((b) => ({
						backend_id: b.backend_id,
						backend_model_id: b.backend_model_id,
						weight: b.weight ?? 1
					}))
				};
				await api.createVModel(payload);
			}
			goto('/vmodels');
		} catch (err) {
			saveError =
				err instanceof Error
					? err.message
					: isEdit
						? 'Failed to update virtual model'
						: 'Failed to create virtual model';
		} finally {
			saving = false;
		}
	}

	onMount(load);
</script>

{#snippet toggle(label: string, checked: boolean, onToggle: () => void)}
	<div class="flex items-center gap-3">
		<button
			type="button"
			onclick={onToggle}
			class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
			class:bg-cyan-500={checked}
			class:bg-gray-700={!checked}
			role="switch"
			aria-checked={checked}
			aria-label={label}
		>
			<span
				class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
				class:translate-x-4={checked}
				class:translate-x-0={!checked}
			></span>
		</button>
		<span class="text-sm text-gray-300">{label}</span>
	</div>
{/snippet}

<svelte:head>
	<title>{isEdit ? 'Edit' : 'New'} Virtual Model — HAAI</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
	<PageHeader
		title={isEdit ? 'Edit Virtual Model' : 'New Virtual Model'}
		subtitle={isEdit ? (vmodel?.model_id ?? '') : 'Route a model ID to a backend pool'}
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
					<label for="vmodel-model-id" class="block text-xs font-medium text-gray-400 mb-1">
						Model ID{isEdit ? '' : ' *'}
					</label>
					<input
						id="vmodel-model-id"
						bind:value={modelId}
						required
						disabled={isEdit}
						placeholder="gpt-4o"
						class="input w-full font-mono"
						class:opacity-60={isEdit}
						class:cursor-not-allowed={isEdit}
					/>
				</div>
				<div>
					<label for="vmodel-display-name" class="block text-xs font-medium text-gray-400 mb-1">
						Display Name *
					</label>
					<input
						id="vmodel-display-name"
						bind:value={displayName}
						required
						placeholder="GPT-4o"
						class="input w-full"
					/>
				</div>
				<div>
					<label for="vmodel-kind" class="block text-xs font-medium text-gray-400 mb-1">Kind</label>
					<select
						id="vmodel-kind"
						value={kind}
						disabled={kindLocked}
						onchange={(e) => handleKindChange(e.currentTarget.value as VModel['kind'])}
						class="input w-full"
						class:opacity-60={kindLocked}
						class:cursor-not-allowed={kindLocked}
					>
						<option value="chat">Chat</option>
						<option value="embedding">Embedding</option>
					</select>
					<p class="mt-1 text-xs text-gray-500">
						{kind === 'embedding'
							? 'Reachable only via POST /v1/embeddings.'
							: 'Reachable only via POST /v1/chat/completions.'}
						{#if kindLocked}
							Locked while backend models are mapped.
						{/if}
					</p>
				</div>
				<div>
					<label for="vmodel-strategy" class="block text-xs font-medium text-gray-400 mb-1">Strategy</label>
					<select id="vmodel-strategy" bind:value={strategy} class="input w-full">
						<option value="session-pin">Session Pin</option>
						<option value="round-robin">Round Robin</option>
						<option value="weighted">Weighted</option>
						<option value="least-connections">Least Connections</option>
						<option value="least-latency">Least Latency</option>
					</select>
				</div>
				<div class="sm:col-span-2 flex items-center gap-6">
					{@render toggle('Streaming', streaming, () => (streaming = !streaming))}
					{@render toggle('Enabled', enabled, () => (enabled = !enabled))}
				</div>

				<div class="sm:col-span-2 border-t border-gray-800 pt-6">
					<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
						Backend Model Mappings
					</h2>
					{#if isEdit}
						<p class="text-xs text-gray-500 mb-3">
							At least one mapping is required. Changes to mappings are saved immediately; other fields are saved with the button below.
						</p>
					{:else}
						<p class="text-xs text-gray-500 mb-3">
							At least one mapping is required. Mappings are created together with the v-model.
						</p>
					{/if}
					{#if backends.length === 0}
						<p class="text-sm text-gray-500 rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2">
							No backends configured. <a href="/backends/new" class="text-cyan-400 hover:text-cyan-300">Add a backend</a> first.
						</p>
					{:else}
						{#if members.length === 0}
							<p class="text-sm text-amber-400 mb-3">No backends assigned yet — add one below.</p>
						{:else}
							<div class="space-y-1.5 mb-4">
								{#each sortedBackends as b (b.id)}
									<div
										class="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing"
										role="listitem"
										draggable="true"
										ondragstart={() => (dragSourceId = b.id)}
										ondragend={() => (dragSourceId = null)}
										ondragover={(e) => e.preventDefault()}
										ondrop={() => handleDragDrop(b.id)}
									>
										<span class="text-xs text-gray-500 font-mono shrink-0 mr-1" aria-hidden="true">⠿</span>
										<span class="text-sm text-gray-200 flex-1">{backendName(b.backend_id)}</span>
										<span class="text-xs text-gray-500 font-mono">{b.backend_model_id}</span>
										{#if b.model_kind && (kind === 'embedding') !== (b.model_kind === 'embeddings')}
											<span
												class="text-xs text-amber-400 bg-amber-900/30 rounded px-1.5 py-0.5"
												title="This member's model kind ({b.model_kind}) doesn't match this v-model's kind ({kind}); it will be treated as unavailable."
											>
												kind mismatch
											</span>
										{/if}
										{#if editingWeightFor === b.id}
											<div class="flex items-center gap-2 shrink-0">
												<input
													type="number"
													bind:value={tempWeight}
													onkeydown={(e) => handleWeightKeydown(e, () => commitWeightEdit(b.id))}
													min="0"
													max="100"
													class="input w-20! shrink-0 text-xs"
													placeholder="weight"
													aria-label="Weight"
												/>
												<button
													type="button"
													onclick={() => commitWeightEdit(b.id)}
													class="text-xs text-green-400 hover:text-green-300"
												>
													Save
												</button>
												<button
													type="button"
													onclick={cancelWeightEdit}
													class="text-xs text-gray-500 hover:text-gray-400"
												>
													Cancel
												</button>
											</div>
										{:else}
											<span class="text-xs font-mono {b.weight != null ? 'text-cyan-400' : 'text-gray-500'}">
												weight: {b.weight ?? 1}
											</span>
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
								onchange={() => (newBackendModelId = '')}
								class="input w-full! min-w-0 text-xs"
								aria-label="Backend"
							>
								<option value="">Select backend…</option>
								{#each backends as b (b.id)}
									<option value={b.id}>{b.name}</option>
								{/each}
							</select>
							<select
								bind:value={newBackendModelId}
								class="input w-full! min-w-0 text-xs"
								disabled={!addBackendId}
								aria-label="Backend model"
							>
								<option value="" disabled>Select model…</option>
								{#if addBackendId && modelsForSelectedBackend.length > 0}
									{#each modelsForSelectedBackend as m (m.id)}
										<option value={m.id}>{m.name}</option>
									{/each}
								{:else if !addBackendId}
									<optgroup label="Select a backend first">
										<option disabled>Select a backend to see available models</option>
									</optgroup>
								{:else if hasMatchingModels}
									<optgroup label="All models mapped">
										<option value="" disabled>— All models from this backend already mapped —</option>
									</optgroup>
								{:else}
									<optgroup
										label={kind === 'embedding' ? 'No embedding models found' : 'No chat models found'}
									>
										<option value="" disabled>
											{kind === 'embedding'
												? '— No embedding models found on this backend —'
												: '— No chat models found on this backend —'}
										</option>
									</optgroup>
								{/if}
							</select>
							<input
								type="number"
								bind:value={addBackendWeight}
								onkeydown={(e) => handleWeightKeydown(e, () => void handleAddBackend())}
								min="0"
								max="100"
								class="input w-full! text-xs"
								placeholder="weight"
								aria-label="Weight"
							/>
							<button
								type="button"
								onclick={() => void handleAddBackend()}
								disabled={!addBackendId || !newBackendModelId || addBackendLoading}
								class="px-3 py-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white rounded-md transition-colors shrink-0 justify-self-start sm:justify-self-auto"
							>
								Add
							</button>
						</div>
					{/if}
				</div>

				<div class="sm:col-span-2 border-t border-gray-800 pt-6">
					{#if !isEdit}
						<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Plugins</h2>
						<p class="text-xs text-gray-500">Save the v-model first, then edit it to add plugins.</p>
					{:else}
						<ScopedPlugins scopeType="vmodel" scopeId={vmodelId!} noun="v-model" />
					{/if}
				</div>

				{#if saveError}
					<div class="sm:col-span-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
						{saveError}
					</div>
				{/if}

				<div class="sm:col-span-2 flex gap-3">
					<button
						type="submit"
						disabled={saving || !canSubmit}
						title={canSubmit ? undefined : 'Add at least one backend model mapping'}
						class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors"
					>
						{#if isEdit}
							{saving ? 'Saving…' : 'Save Changes'}
						{:else}
							{saving ? 'Creating…' : 'Create'}
						{/if}
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

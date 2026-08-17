<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type VModel } from '$lib/api.js';
	import { normalizeVModelAllowList, vModelMatchesAllowList } from '$lib/vmodel-utils.js';

	interface Props {
		restrict: boolean;
		selectedIds: string[];
	}

	let { restrict = $bindable(false), selectedIds = $bindable([]) }: Props = $props();

	let vmodels = $state<VModel[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	const enabledVModels = $derived(vmodels.filter((vm) => vm.enabled));

	onMount(async () => {
		try {
			vmodels = await api.getVModels();
			if (restrict && selectedIds.length > 0) {
				selectedIds = normalizeVModelAllowList(selectedIds, vmodels);
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load virtual models';
		} finally {
			loading = false;
		}
	});

	const mode = $derived(!restrict ? 'all' : selectedIds.length > 0 ? 'specific' : 'none');

		function setMode(m: 'all' | 'specific' | 'none') {
			if (m === 'all') {
				restrict = false;
				selectedIds = [];
			} else if (m === 'specific') {
				restrict = true;
				if (selectedIds.length === 0) {
					selectedIds = enabledVModels.map((vm) => vm.model_id);
				} else {
					selectedIds = normalizeVModelAllowList(selectedIds, enabledVModels);
				}
			} else {
				restrict = true;
				selectedIds = [];
			}
		}

		function toggleModel(vm: VModel) {
			if (vModelMatchesAllowList(vm, selectedIds)) {
				selectedIds = selectedIds.filter((id) => id !== vm.model_id && id !== vm.id);
			} else {
				selectedIds = [...selectedIds, vm.model_id];
			}
		}

		function displayName(vm: VModel): string {
			return vm.display_name && vm.display_name !== vm.model_id ? `${vm.model_id} — ${vm.display_name}` : vm.model_id;
		}
</script>

<div class="space-y-2">
	<div class="flex items-center justify-between">
		<span class="text-xs font-medium text-gray-300">Virtual models</span>
		{#if !loading && !loadError && enabledVModels.length > 0}
			<div class="flex rounded-md overflow-hidden border border-gray-700 text-xs">
				<button
					type="button"
					onclick={() => setMode('all')}
					class="px-3 py-1 transition-colors"
					class:bg-gray-700={mode === 'all'}
					class:text-white={mode === 'all'}
					class:bg-transparent={mode !== 'all'}
					class:text-gray-400={mode !== 'all'}
					class:hover:text-gray-200={mode !== 'all'}
				>All</button>
				<button
					type="button"
					onclick={() => setMode('specific')}
					class="px-3 py-1 transition-colors border-l border-gray-700"
					class:bg-gray-700={mode === 'specific'}
					class:text-white={mode === 'specific'}
					class:bg-transparent={mode !== 'specific'}
					class:text-gray-400={mode !== 'specific'}
					class:hover:text-gray-200={mode !== 'specific'}
				>Specific</button>
				<button
					type="button"
					onclick={() => setMode('none')}
					class="px-3 py-1 transition-colors border-l border-gray-700"
					class:bg-gray-700={mode === 'none'}
					class:text-white={mode === 'none'}
					class:bg-transparent={mode !== 'none'}
					class:text-gray-400={mode !== 'none'}
					class:hover:text-gray-200={mode !== 'none'}
				>None</button>
			</div>
		{/if}
	</div>

	{#if loading}
		<p class="text-xs text-gray-500">Loading…</p>
	{:else if loadError}
		<p class="text-xs text-red-400">{loadError}</p>
	{:else if enabledVModels.length === 0}
		<p class="text-xs text-gray-500">
			No virtual models yet. <a href="/vmodels/new" class="text-cyan-400 hover:text-cyan-300">Create one →</a>
		</p>
	{:else if mode === 'all'}
		<p class="text-xs text-gray-500">This key can use all {enabledVModels.length} virtual model{enabledVModels.length === 1 ? '' : 's'}.</p>
	{:else if mode === 'specific'}
		<div class="space-y-1.5 rounded-lg border border-gray-700 bg-gray-950/50 p-3">
			{#each enabledVModels as vm (vm.id)}
				<label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
					<input
						type="checkbox"
						class="checkbox"
						checked={vModelMatchesAllowList(vm, selectedIds)}
						onchange={() => toggleModel(vm)}
					/>
					<span class="font-mono text-cyan-400/90">{vm.model_id}</span>
					{#if vm.display_name && vm.display_name !== vm.model_id}
						<span class="text-gray-500 text-xs">— {vm.display_name}</span>
					{/if}
					{#if vm.backends.length === 0}
						<span class="text-amber-500/70 text-xs">(no backends)</span>
					{/if}
				</label>
			{/each}
		</div>
	{:else}
		<p class="text-xs text-gray-500/80">No virtual models — this key cannot use any v-model aliases.</p>
	{/if}
</div>

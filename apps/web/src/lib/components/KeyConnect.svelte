<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type VModel } from '$lib/api.js';
	import { getProxyBaseUrl } from '$lib/proxy-base.js';
	import { buildAivmPromptCommand, buildChatCompletionUrl } from '$lib/connection-details.js';
	import {
		connectableVModels,
		eligibleVModelsForKey,
		getVModelAvailabilityIssue
	} from '$lib/vmodel-utils.js';

	interface Props {
		keyPrefix: string;
		retrievable: boolean;
		fetchSecret: () => Promise<string>;
		allowedVModels?: string[];
		initialSecret?: string | null;
		class?: string;
	}

	let {
		keyPrefix,
		retrievable,
		fetchSecret,
		allowedVModels,
		initialSecret = null,
		class: className = ''
	}: Props = $props();

	let modalOpen = $state(false);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let secret = $state<string | null>(initialSecret);
	let vmodels = $state<VModel[]>([]);
	let selectedModelId = $state('');
	let copiedField = $state<string | null>(null);

	const baseUrl = $derived(getProxyBaseUrl());
	const endpointUrl = $derived(buildChatCompletionUrl(baseUrl));

	const selectableVModels = $derived(eligibleVModelsForKey(vmodels, allowedVModels));

	const availabilityIssue = $derived(getVModelAvailabilityIssue(vmodels, allowedVModels));

	const selectedVModel = $derived(
		selectableVModels.find((vm) => vm.id === selectedModelId) ?? null
	);

	const selectedHasBackends = $derived((selectedVModel?.backends.length ?? 0) > 0);

	const apiKeyDisplay = $derived(secret ?? (retrievable ? null : `${keyPrefix}…`));

	const cliExample = $derived.by(() => {
		if (!selectedModelId || !apiKeyDisplay || !selectedHasBackends) return null;
		return buildAivmPromptCommand(
			baseUrl,
			apiKeyDisplay,
			selectedModelId,
			'Hello!',
			selectedVModel?.streaming ?? true
		);
	});

	async function openModal() {
		modalOpen = true;
		loadError = null;
		loading = true;

		try {
			const tasks: Promise<unknown>[] = [api.getVModels()];
			if (!(secret ?? initialSecret) && retrievable) {
				tasks.push(fetchSecret().then((k) => (secret = k)));
			}
			const [loadedVModels] = (await Promise.all(tasks)) as [VModel[]];

			vmodels = loadedVModels;
			const eligible = eligibleVModelsForKey(loadedVModels, allowedVModels);
			if (!eligible.some((vm) => vm.id === selectedModelId)) {
				const preferred = connectableVModels(loadedVModels, allowedVModels);
				selectedModelId = (preferred[0] ?? eligible[0])?.id ?? '';
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load connection details';
		} finally {
			loading = false;
		}
	}

	function closeModal() {
		modalOpen = false;
		loadError = null;
		copiedField = null;
		if (!initialSecret) {
			secret = null;
		}
	}

	async function copyField(field: string, value: string) {
		await navigator.clipboard.writeText(value);
		copiedField = field;
		setTimeout(() => {
			if (copiedField === field) copiedField = null;
		}, 1500);
	}

	function copyLabel(field: string): string {
		return copiedField === field ? 'Copied' : 'Copy';
	}
</script>

<div class={className}>
	<button
		type="button"
		onclick={openModal}
		disabled={loading}
		class="px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-md transition-colors whitespace-nowrap"
	>
		{loading ? 'Loading…' : 'Connect'}
	</button>
</div>

<Modal open={modalOpen} title="Connect with this key" onclose={closeModal}>
	{#if loading}
		<p class="text-sm text-gray-400">Loading…</p>
	{:else if loadError}
		<p class="text-sm text-red-400">{loadError}</p>
	{:else if availabilityIssue === 'none'}
		<p class="text-sm text-gray-400">
			No virtual models are configured yet.
			<a href="/vmodels/new" class="text-cyan-400 hover:text-cyan-300">Create a v-model →</a>
		</p>
	{:else if availabilityIssue === 'key_restricted'}
		<p class="text-sm text-gray-400">
			This key is restricted to v-models that don't exist or aren't enabled. Edit the key's
			<strong class="text-gray-300">allowed v-models</strong> setting.
		</p>
	{:else if selectableVModels.length === 0}
		<p class="text-sm text-gray-400">No virtual models are available for this key.</p>
	{:else}
		<div class="space-y-4">
			<div>
				<label for="connect-vmodel" class="block text-xs font-medium text-gray-400 mb-1">
					Virtual model
				</label>
				<select id="connect-vmodel" bind:value={selectedModelId} class="input w-full">
					{#each selectableVModels as vm (vm.id)}
						<option value={vm.id}>
							{vm.display_name || vm.model_id} ({vm.model_id}){vm.backends.length === 0
								? ' — no backends'
								: ''}
						</option>
					{/each}
				</select>
			</div>

			{#if selectedVModel && !selectedHasBackends}
				<p class="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2">
					<strong>{selectedVModel.model_id}</strong> has no backends configured — requests will fail until
					you
					<a href="/vmodels/{selectedVModel.id}/edit" class="text-cyan-400 hover:text-cyan-300">
						add a backend
					</a>.
				</p>
			{/if}

			{#if !secret && !retrievable}
				<p class="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2">
					This key was shown once and is not stored. Replace the placeholder below with the key you
					saved at creation.
				</p>
			{/if}

			<div class="space-y-3">
				<div>
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-medium text-gray-400">Base URL</span>
						<button
							type="button"
							onclick={() => copyField('base', baseUrl)}
							class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors min-w-[2.5rem] text-right"
						>
							{copyLabel('base')}
						</button>
					</div>
					<code
						class="block font-mono text-xs text-cyan-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 break-all"
					>
						{baseUrl}
					</code>
				</div>

				<div>
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-medium text-gray-400">Endpoint</span>
						<button
							type="button"
							onclick={() => copyField('endpoint', endpointUrl)}
							class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors min-w-[2.5rem] text-right"
						>
							{copyLabel('endpoint')}
						</button>
					</div>
					<code
						class="block font-mono text-xs text-cyan-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 break-all"
					>
						{endpointUrl}
					</code>
				</div>

				<div>
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-medium text-gray-400">API key</span>
						{#if apiKeyDisplay}
							<button
								type="button"
								onclick={() => copyField('key', apiKeyDisplay)}
								class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors min-w-[2.5rem] text-right"
							>
								{copyLabel('key')}
							</button>
						{/if}
					</div>
					<code
						class="block font-mono text-xs text-cyan-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 break-all"
					>
						{apiKeyDisplay ?? '…'}
					</code>
				</div>

				<div>
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-medium text-gray-400">Model</span>
						{#if selectedModelId}
							<button
								type="button"
								onclick={() => copyField('model', selectedModelId)}
								class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors min-w-[2.5rem] text-right"
							>
								{copyLabel('model')}
							</button>
						{/if}
					</div>
					<code
						class="block font-mono text-xs text-cyan-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 break-all"
					>
						{selectedModelId}
					</code>
				</div>
			</div>

			{#if cliExample}
				<div>
					<div class="flex items-center justify-between mb-1">
						<span class="text-xs font-medium text-gray-400">aivm example</span>
						<button
							type="button"
							onclick={() => copyField('cli', cliExample)}
							class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors min-w-[2.5rem] text-right"
						>
							{copyLabel('cli')}
						</button>
					</div>
					<pre
						class="font-mono text-xs text-gray-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto"
					><code>{cliExample}</code></pre>
				</div>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		{#if cliExample}
			<button
				type="button"
				onclick={() => copyField('cli-footer', cliExample)}
				class="px-3 py-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 text-white rounded-md transition-colors min-w-[7.5rem]"
			>
				{copyLabel('cli-footer') === 'Copied' ? 'Copied' : 'Copy command'}
			</button>
		{/if}
		<button
			type="button"
			onclick={closeModal}
			class="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors"
		>
			Close
		</button>
	{/snippet}
</Modal>

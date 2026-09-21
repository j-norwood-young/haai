<script lang="ts">
	import Modal from './Modal.svelte';
	import { api, type AvailableModel, type VModel } from '$lib/api.js';
	import { getProxyBaseUrl } from '$lib/proxy-base.js';
	import {
		EXAMPLE_LANGUAGES,
		EXAMPLE_OPERATIONS,
		buildExample,
		getExampleOperation,
		isExampleSupported,
		type ExampleLanguage,
		type ExampleOperation
	} from '$lib/connection-details.js';
	import { buildConnectModels, getConnectAvailabilityIssue } from '$lib/connect-models.js';

	interface Props {
		keyPrefix: string;
		retrievable: boolean;
		fetchSecret: () => Promise<string>;
		/** null/undefined = all; an empty list = none (matches the proxy). */
		allowedVModels?: string[] | null | undefined;
		allowedBackends?: string[] | null | undefined;
		initialSecret?: string | null;
		class?: string;
	}

	let {
		keyPrefix,
		retrievable,
		fetchSecret,
		allowedVModels,
		allowedBackends,
		initialSecret = null,
		class: className = ''
	}: Props = $props();

	let modalOpen = $state(false);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let secret = $state<string | null>(null);
	let vmodels = $state<VModel[]>([]);
	let available = $state<AvailableModel[]>([]);
	let selectedModelId = $state('');
	let copiedField = $state<string | null>(null);

	let operation = $state<ExampleOperation>('chat');
	let language = $state<ExampleLanguage>('haai');

	const baseUrl = $derived(getProxyBaseUrl());
	const operationInfo = $derived(getExampleOperation(operation));

	const allModels = $derived(
		buildConnectModels(vmodels, available, allowedVModels, allowedBackends)
	);

	// Only models of the kind the chosen endpoint serves (the proxy rejects a mismatch).
	const selectableModels = $derived(
		operationInfo.vmodelKind
			? allModels.filter((m) => m.kind === operationInfo.vmodelKind)
			: allModels
	);
	const selectableVModels = $derived(selectableModels.filter((m) => m.source === 'vmodel'));
	const selectablePassthrough = $derived(selectableModels.filter((m) => m.source === 'passthrough'));

	const availabilityIssue = $derived(getConnectAvailabilityIssue(vmodels, available, allModels));

	// Falls back to the best available model when the pick doesn't apply to this endpoint.
	const activeModelId = $derived.by(() => {
		if (selectableModels.some((m) => m.id === selectedModelId)) return selectedModelId;
		return (selectableModels.find((m) => m.ready) ?? selectableModels[0])?.id ?? '';
	});

	const selectedModel = $derived(selectableModels.find((m) => m.id === activeModelId) ?? null);

	const currentSecret = $derived(secret ?? initialSecret);

	const apiKeyDisplay = $derived(currentSecret ?? (retrievable ? null : `${keyPrefix}…`));

	// The haai CLI can only send chat prompts; other endpoints fall back to curl.
	const activeLanguage = $derived<ExampleLanguage>(
		isExampleSupported(language, operation) ? language : 'curl'
	);

	const example = $derived.by(() => {
		if (!apiKeyDisplay) return null;
		if (operationInfo.needsModel && (!selectedModel || !selectedModel.ready)) return null;
		return buildExample(activeLanguage, operation, {
			baseUrl,
			apiKey: apiKeyDisplay,
			modelId: activeModelId,
			stream: selectedModel?.streaming ?? true
		});
	});

	async function openModal() {
		modalOpen = true;
		loadError = null;
		loading = true;

		try {
			const tasks: Promise<unknown>[] = [
				api.getVModels(),
				// Pass-through models are additive: if the catalog can't load, still offer v-models.
				api.getAvailableModels().then(
					(r) => r.models,
					() => [] as AvailableModel[]
				)
			];
			if (!currentSecret && retrievable) {
				tasks.push(fetchSecret().then((k) => (secret = k)));
			}
			const [loadedVModels, loadedAvailable] = (await Promise.all(tasks)) as [
				VModel[],
				AvailableModel[]
			];

			vmodels = loadedVModels;
			available = loadedAvailable;
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
		secret = null;
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
			No virtual models or backend models are configured yet.
			<a href="/vmodels/new" class="text-cyan-400 hover:text-cyan-300">Create a v-model →</a>
		</p>
	{:else if availabilityIssue === 'key_restricted'}
		<p class="text-sm text-gray-400">
			This key isn't allowed to use any models that exist. Edit the key's
			<strong class="text-gray-300">allowed v-models</strong> or
			<strong class="text-gray-300">pass-through backends</strong> setting.
		</p>
	{:else}
		<div class="space-y-4">
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

				{#if !currentSecret && !retrievable}
					<p
						class="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2"
					>
						This key was shown once and is not stored. Replace the placeholder above with the key you
						saved at creation.
					</p>
				{/if}
			</div>

			<section
				class="rounded-lg border border-gray-800 bg-gray-900/50 p-3 space-y-3"
				aria-label="Try it"
				data-testid="connect-sandbox"
			>
				<div>
					<span class="block text-xs font-medium text-gray-400 mb-1">Endpoint</span>
					<div class="flex items-center gap-1" role="group" aria-label="Endpoint">
						{#each EXAMPLE_OPERATIONS as op (op.id)}
							<button
								type="button"
								aria-pressed={operation === op.id}
								data-testid="connect-op-{op.id}"
								onclick={() => (operation = op.id)}
								class="px-2.5 py-1 text-xs rounded-md transition-colors {operation === op.id
									? 'bg-cyan-500 text-white'
									: 'bg-gray-800 text-gray-300 hover:bg-gray-700'}"
							>
								{op.label}
							</button>
						{/each}
					</div>
				</div>

				{#if operationInfo.needsModel}
					<div>
						<div class="flex items-center justify-between mb-1">
							<label for="connect-vmodel" class="text-xs font-medium text-gray-400">Model</label>
							{#if activeModelId}
								<button
									type="button"
									onclick={() => copyField('model', activeModelId)}
									class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors min-w-[2.5rem] text-right"
								>
									{copyLabel('model')}
								</button>
							{/if}
						</div>
						{#if selectableModels.length === 0}
							<p
								class="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2"
							>
								No {operationInfo.vmodelKind} models are available for this key.
								<a href="/vmodels/new" class="text-cyan-400 hover:text-cyan-300">Create a v-model →</a>
							</p>
						{:else}
							<select
								id="connect-vmodel"
								value={activeModelId}
								onchange={(e) => (selectedModelId = e.currentTarget.value)}
								class="input w-full"
							>
								{#if selectableVModels.length > 0}
									<optgroup label="Virtual models">
										{#each selectableVModels as m (m.id)}
											<option value={m.id}>{m.label}{m.ready ? '' : ' — no backends'}</option>
										{/each}
									</optgroup>
								{/if}
								{#if selectablePassthrough.length > 0}
									<optgroup label="Pass-through backends">
										{#each selectablePassthrough as m (m.id)}
											<option value={m.id}>{m.label}</option>
										{/each}
									</optgroup>
								{/if}
							</select>
						{/if}
					</div>

					{#if selectedModel?.vmodel && !selectedModel.ready}
						<p
							class="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2"
						>
							<strong>{selectedModel.id}</strong> has no backends configured — requests will fail
							until you
							<a href="/vmodels/{selectedModel.vmodel.id}/edit" class="text-cyan-400 hover:text-cyan-300">
								add a backend
							</a>.
						</p>
					{/if}
				{/if}

				{#if example}
					<div>
						<div class="flex items-center justify-between mb-1">
							<div class="flex items-center gap-1" role="tablist" aria-label="Example language">
								{#each EXAMPLE_LANGUAGES as lang (lang.id)}
									{@const supported = isExampleSupported(lang.id, operation)}
									<button
										type="button"
										role="tab"
										id="connect-tab-{lang.id}"
										aria-selected={activeLanguage === lang.id}
										aria-controls="connect-example"
										data-testid="connect-lang-{lang.id}"
										disabled={!supported}
										title={supported ? undefined : 'The haai CLI has no embeddings command'}
										onclick={() => (language = lang.id)}
										class="px-2.5 py-1 text-xs rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed {activeLanguage ===
										lang.id
											? 'bg-gray-800 text-cyan-300'
											: 'text-gray-400 hover:text-gray-200'}"
									>
										{lang.label}
									</button>
								{/each}
							</div>
							<button
								type="button"
								onclick={() => copyField('example', example)}
								class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors min-w-[2.5rem] text-right"
							>
								{copyLabel('example')}
							</button>
						</div>
						<div
							id="connect-example"
							role="tabpanel"
							aria-labelledby="connect-tab-{activeLanguage}"
						>
							<pre
								data-testid="connect-example"
								class="font-mono text-xs text-gray-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 overflow-x-auto max-h-72 overflow-y-auto"
							><code>{example}</code></pre>
						</div>
					</div>
				{/if}
			</section>
		</div>
	{/if}

	{#snippet footer()}
		{#if example}
			<button
				type="button"
				onclick={() => copyField('example-footer', example)}
				class="px-3 py-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 text-white rounded-md transition-colors min-w-[7.5rem]"
			>
				{copyLabel('example-footer') === 'Copied' ? 'Copied' : 'Copy example'}
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

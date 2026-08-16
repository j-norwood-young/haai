<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { ApiKey } from '$lib/api.js';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SecretReveal from '$lib/components/SecretReveal.svelte';
	import KeyConnect from '$lib/components/KeyConnect.svelte';
	import AllowedVModelsPicker from '$lib/components/AllowedVModelsPicker.svelte';
	import AllowedBackendsPicker from '$lib/components/AllowedBackendsPicker.svelte';
	import {
		allowedBackendsPayload,
		allowedVModelsPayload,
		validateKeyAccessSelection
	} from '$lib/vmodel-utils.js';

	let name = $state('');
	let rpmLimit = $state('');
	let dayBudget = $state('');
	let expires = $state('');
	let restrictVModels = $state(false);
	let selectedVModelIds = $state<string[]>([]);
	let restrictBackends = $state(false);
	let selectedBackendIds = $state<string[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(false);
	let newKeyValue = $state<string | null>(null);
	let newKeyPrefix = $state('');
	let showOnce = $state(false);

	const allowedForConnect = $derived(
		restrictVModels && selectedVModelIds.length > 0 ? selectedVModelIds : undefined
	);

	const noModelAccess = $derived(
		restrictVModels &&
			selectedVModelIds.length === 0 &&
			restrictBackends &&
			selectedBackendIds.length === 0
	);

	onMount(async () => {
		try {
			const settings = await api.getSettings();
			showOnce = settings.apiKeys.showOnce;
		} catch {
			// default: keys are retrievable
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const accessError = validateKeyAccessSelection(
			restrictVModels,
			selectedVModelIds,
			restrictBackends,
			selectedBackendIds
		);
		if (accessError) {
			error = accessError;
			return;
		}

		loading = true;
		error = null;
		try {
			const data: Partial<ApiKey> = { name };
			if (rpmLimit) data.rpm_limit = parseInt(rpmLimit);
			if (dayBudget) data.day_budget = parseFloat(dayBudget);
			if (expires) data.expires_at = expires;
			const allowed_vmodels = allowedVModelsPayload(
				restrictVModels,
				selectedVModelIds,
				'create'
			);
			const allowed_backends = allowedBackendsPayload(
				restrictBackends,
				selectedBackendIds,
				'create'
			);
			if (allowed_vmodels !== undefined) data.allowed_vmodels = allowed_vmodels;
			if (allowed_backends !== undefined) data.allowed_backends = allowed_backends;

			const result = await api.createKey(data);
			newKeyValue = result.key;
			newKeyPrefix = result.key_prefix;
			showOnce = result.showOnce;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create key';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>New API Key — AiVM</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto space-y-4">
	<PageHeader
		title="New API Key"
		subtitle="Keys are active immediately after creation"
		parentHref="/keys"
		parentLabel="API Keys"
	/>

	{#if newKeyValue}
		<div class="bg-green-900/20 border border-green-700 rounded-xl p-4">
			<p class="text-sm font-medium text-green-400 mb-3">
				{#if showOnce}
					Key created — copy it now, it won't be shown again
				{:else}
					Key created — you can reveal and copy it from the keys list anytime
				{/if}
			</p>
			<div class="flex items-center gap-2 flex-wrap mb-4">
				<SecretReveal
					retrievable={!showOnce}
					initialSecret={newKeyValue}
					autoOpen={true}
					modalTitle={showOnce ? 'Copy your new API key' : 'Your new API key'}
					fetchSecret={async () => newKeyValue ?? ''}
				/>
				<KeyConnect
					keyPrefix={newKeyPrefix}
					retrievable={!showOnce}
					initialSecret={newKeyValue}
					allowedVModels={allowedForConnect}
					fetchSecret={async () => newKeyValue ?? ''}
				/>
			</div>
			<a href="/keys" class="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">
				← Back to keys
			</a>
		</div>
	{:else}
		<form onsubmit={handleSubmit} class="space-y-4">
			<!-- Card 1: Basic Settings -->
			<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
				<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
					Basic Settings
				</h2>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div class="sm:col-span-2">
						<label for="new-key-name" class="block text-xs font-medium text-gray-400 mb-1">Key Name *</label>
						<input
							id="new-key-name"
							bind:value={name}
							required
							placeholder="e.g. my-app-prod"
							class="input w-full"
						/>
					</div>
					<div>
						<label for="new-rpm-limit" class="block text-xs font-medium text-gray-400 mb-1">RPM Limit</label>
						<input
							id="new-rpm-limit"
							bind:value={rpmLimit}
							type="number"
							min="1"
							placeholder="Unlimited"
							class="input w-full"
						/>
					</div>
					<div>
						<label for="new-day-budget" class="block text-xs font-medium text-gray-400 mb-1">Daily Token Budget</label>
						<input
							id="new-day-budget"
							bind:value={dayBudget}
							type="number"
							min="0"
							step="0.01"
							placeholder="Unlimited"
							class="input w-full"
						/>
					</div>
					<div class="sm:col-span-2">
						<label for="new-expires" class="block text-xs font-medium text-gray-400 mb-1">Expires At</label>
						<input id="new-expires" bind:value={expires} type="datetime-local" class="input w-full" />
					</div>
				</div>
			</div>

			<!-- Card 2: Model Access -->
			<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
				<div class="mb-4">
					<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Model Access</h2>
					<p class="text-xs text-gray-500 mt-1">
						Control which models this key can see in <code class="text-gray-400">/v1/models</code> and
						call. By default the key can access everything.
					</p>
				</div>

				<div class="space-y-4">
					<AllowedVModelsPicker bind:restrict={restrictVModels} bind:selectedIds={selectedVModelIds} />

					<div class="border-t border-gray-800"></div>

					<AllowedBackendsPicker
						bind:restrict={restrictBackends}
						bind:selectedIds={selectedBackendIds}
					/>
				</div>

				{#if noModelAccess}
					<div
						class="mt-4 flex items-start gap-2 rounded-lg bg-amber-900/20 border border-amber-800/60 px-3 py-2.5"
					>
						<span class="text-amber-400 text-sm leading-none mt-0.5">⚠</span>
						<p class="text-xs text-amber-300">
							No models are selected in either section. This key will not be able to see or call any
							models.
						</p>
					</div>
				{/if}
			</div>

			<!-- Actions -->
			<div class="flex gap-3 items-center">
				<button
					type="submit"
					disabled={loading}
					class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors"
				>
					{loading ? 'Creating…' : 'Create Key'}
				</button>
				<a
					href="/keys"
					class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors"
				>
					Cancel
				</a>
				{#if error}
					<span class="text-sm text-red-400">{error}</span>
				{/if}
			</div>
		</form>
	{/if}
</div>

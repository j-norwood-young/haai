<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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

	const id = $derived(page.params.id!);

	let key = $state<ApiKey | null>(null);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let suspendReason = $state('');

	let name = $state('');
	let rpmLimit = $state('');
	let dayBudget = $state('');
	let expires = $state('');
	let enabled = $state(true);
	let restrictVModels = $state(false);
	let selectedVModelIds = $state<string[]>([]);
	let restrictBackends = $state(false);
	let selectedBackendIds = $state<string[]>([]);

	const noModelAccess = $derived(
		restrictVModels &&
			selectedVModelIds.length === 0 &&
			restrictBackends &&
			selectedBackendIds.length === 0
	);

	async function load() {
		loading = true;
		error = null;
		try {
			key = await api.getKey(id);
			name = key.name;
			rpmLimit = key.rpm_limit != null ? String(key.rpm_limit) : '';
			dayBudget = key.day_budget != null ? String(key.day_budget) : '';
			expires = key.expires_at ? key.expires_at.slice(0, 16) : '';
			enabled = key.enabled;
			restrictVModels = !!key.allowed_vmodels?.length;
			selectedVModelIds = key.allowed_vmodels ?? [];
			restrictBackends = !!key.allowed_backends?.length;
			selectedBackendIds = key.allowed_backends ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load key';
		} finally {
			loading = false;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const accessError = validateKeyAccessSelection(
			restrictVModels,
			selectedVModelIds,
			restrictBackends,
			selectedBackendIds
		);
		if (accessError) {
			saveError = accessError;
			return;
		}

		saving = true;
		saveError = null;
		try {
			const update: Partial<ApiKey> = { name, enabled };
			if (rpmLimit) update.rpm_limit = parseInt(rpmLimit);
			if (dayBudget) update.day_budget = parseFloat(dayBudget);
			if (expires) update.expires_at = expires;
			const allowed_vmodels = allowedVModelsPayload(
				restrictVModels,
				selectedVModelIds,
				'update'
			);
			const allowed_backends = allowedBackendsPayload(
				restrictBackends,
				selectedBackendIds,
				'update'
			);
			if (allowed_vmodels !== undefined) update.allowed_vmodels = allowed_vmodels;
			if (allowed_backends !== undefined) update.allowed_backends = allowed_backends;

			await api.updateKey(id, update);
			goto('/keys');
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to update key';
		} finally {
			saving = false;
		}
	}

	async function handleSuspend() {
		try {
			key = await api.suspendKey(id, suspendReason);
			suspendReason = '';
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to suspend key';
		}
	}

	async function handleResume() {
		try {
			key = await api.resumeKey(id);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to resume key';
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Edit API Key — AiVM</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto space-y-4">
	<PageHeader
		title="Edit API Key"
		subtitle={key ? `${key.key_prefix}…` : ''}
		parentHref="/keys"
		parentLabel="API Keys"
	/>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm">
			{error}
		</div>
	{:else if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if key}
		<!-- Card 1: API Key display -->
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">API Key</h2>
			<div class="flex items-center gap-2 flex-wrap">
				<SecretReveal
					retrievable={key.retrievable}
					fetchSecret={() => api.revealKey(id)}
					unavailableLabel="Not stored — show-once mode or legacy key"
				/>
				<KeyConnect
					keyPrefix={key.key_prefix}
					retrievable={key.retrievable}
					allowedVModels={key.allowed_vmodels}
					fetchSecret={() => api.revealKey(id)}
				/>
			</div>
		</div>

		<form onsubmit={handleSubmit} class="space-y-4">
			<!-- Card 2: Basic Settings -->
			<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
				<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
					Basic Settings
				</h2>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div class="sm:col-span-2">
						<label for="edit-key-name" class="block text-xs font-medium text-gray-400 mb-1">Key Name</label>
						<input id="edit-key-name" bind:value={name} required class="input w-full" />
					</div>

					<!-- Key active toggle -->
					<div class="sm:col-span-2 flex items-start gap-3 py-1">
						<button
							type="button"
							onclick={() => (enabled = !enabled)}
							class="mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none"
							class:bg-cyan-500={enabled}
							class:bg-gray-700={!enabled}
							role="switch"
							aria-checked={enabled}
							aria-label="Key active — allow requests with this key"
							disabled={key.suspended}
						>
							<span
								class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
								class:translate-x-4={enabled}
								class:translate-x-0={!enabled}
							></span>
						</button>
						<div>
							<p class="text-sm font-medium text-gray-200">Key active — allow requests with this key</p>
							<p class="text-xs text-gray-500 mt-0.5">
								{#if key.suspended}
									This key is suspended — resume it below before re-enabling.
								{:else if enabled}
									Requests using this key will be accepted.
								{:else}
									Requests using this key will be rejected with 403.
								{/if}
							</p>
						</div>
						{#if key.suspended}
							<span
								class="ml-auto px-2 py-0.5 rounded-full text-xs border bg-yellow-500/20 text-yellow-400 border-yellow-800 whitespace-nowrap self-start mt-0.5"
							>
								Suspended{key.suspended_reason ? `: ${key.suspended_reason}` : ''}
							</span>
						{/if}
					</div>

					<div>
						<label for="edit-rpm-limit" class="block text-xs font-medium text-gray-400 mb-1">RPM Limit</label>
						<input
							id="edit-rpm-limit"
							bind:value={rpmLimit}
							type="number"
							min="1"
							placeholder="Unlimited"
							class="input w-full"
						/>
					</div>
					<div>
						<label for="edit-day-budget" class="block text-xs font-medium text-gray-400 mb-1">Daily Token Budget</label>
						<input
							id="edit-day-budget"
							bind:value={dayBudget}
							type="number"
							min="0"
							step="0.01"
							placeholder="Unlimited"
							class="input w-full"
						/>
					</div>
					<div class="sm:col-span-2">
						<label for="edit-expires" class="block text-xs font-medium text-gray-400 mb-1">Expires At</label>
						<input id="edit-expires" bind:value={expires} type="datetime-local" class="input w-full" />
					</div>
				</div>
			</div>

			<!-- Card 3: Model Access -->
			<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
				<div class="mb-4">
					<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Model Access</h2>
					<p class="text-xs text-gray-500 mt-1">
						Control which models this key can see in <code class="text-gray-400">/v1/models</code> and
						call. At least one source must be available.
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
							This key has no models available. It must be able to access at least one v-model or one
							pass-through backend, otherwise all requests will fail.
						</p>
					</div>
				{/if}
			</div>

			<!-- Actions -->
			<div class="flex gap-3 items-center">
				<button
					type="submit"
					disabled={saving}
					class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors"
				>
					{saving ? 'Saving…' : 'Save Changes'}
				</button>
				<a
					href="/keys"
					class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors"
				>
					Cancel
				</a>
				{#if saveError}
					<span class="self-center text-sm text-red-400">{saveError}</span>
				{/if}
			</div>
		</form>

		<!-- Card 4: Suspension (outside the form) -->
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Suspension</h2>
			<p class="text-xs text-gray-500 mb-3">
				Suspended keys are rejected immediately with a "key suspended" error. Different from
				disabling — suspension carries an optional reason visible in logs.
			</p>
			{#if key.suspended}
				<button
					onclick={handleResume}
					class="px-4 py-2 bg-green-900/40 hover:bg-green-800 text-green-400 font-medium rounded-lg text-sm transition-colors"
				>
					Resume Key
				</button>
			{:else}
				<div class="flex gap-2">
					<input bind:value={suspendReason} placeholder="Reason (optional)" class="input flex-1" />
					<button
						onclick={handleSuspend}
						class="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white font-medium rounded-lg text-sm transition-colors whitespace-nowrap"
					>
						Suspend Key
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

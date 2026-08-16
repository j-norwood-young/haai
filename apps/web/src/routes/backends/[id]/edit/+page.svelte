<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api.js';
	import type { Backend } from '$lib/api.js';
	import { backendHealthState } from '$lib/backend-health-state.svelte.js';
	import Modal from '$lib/components/Modal.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	const id = $derived(page.params.id!);

	let backend = $state<Backend | null>(null);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let testResult = $state<{
		success: boolean;
		latency_ms?: number;
		error?: string;
		loading: boolean;
	} | null>(null);
	let saveConfirmOpen = $state(false);
	let pendingTestError = $state<string | null>(null);

	let name = $state('');
	let url = $state('');
	let apiKey = $state('');
	let enabled = $state(true);

	function draftTestOverrides(): { url?: string; api_key?: string } {
		const overrides: { url?: string; api_key?: string } = {};
		if (url.trim()) overrides.url = url.trim();
		if (apiKey) overrides.api_key = apiKey;
		return overrides;
	}

	function applyTestResult(result: {
		success: boolean;
		latency_ms?: number;
		health?: 'healthy' | 'degraded' | 'unhealthy';
		error?: string;
	}) {
		const next: {
			success: boolean;
			loading: boolean;
			latency_ms?: number;
			error?: string;
		} = {
			success: result.success,
			loading: false
		};
		if (result.latency_ms !== undefined) next.latency_ms = result.latency_ms;
		if (result.error !== undefined) next.error = result.error;
		testResult = next;
		if (result.health && backend) {
			const updated: Backend = { ...backend, health: result.health };
			const latency = result.latency_ms ?? backend.latency_ms;
			if (latency !== undefined) updated.latency_ms = latency;
			if (result.error) updated.health_error = result.error;
			else delete updated.health_error;
			backend = updated;
		}
	}

	async function runConnectionTest(): Promise<{
		success: boolean;
		latency_ms?: number;
		health?: 'healthy' | 'degraded' | 'unhealthy';
		error?: string;
	}> {
		return api.testBackend(id, draftTestOverrides());
	}

	async function load() {
		loading = true;
		error = null;
		try {
			backend = await api.getBackend(id);
			name = backend.name;
			url = backend.url;
			enabled = backend.enabled;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load backend';
		} finally {
			loading = false;
		}
	}

	async function persistChanges() {
		await api.updateBackend(id, {
			name,
			url,
			enabled,
			...(apiKey ? { api_key: apiKey } : {})
		});
		void backendHealthState.refresh();
		goto('/backends');
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		saveError = null;
		pendingTestError = null;
		testResult = { success: false, loading: true };
		try {
			let result;
			try {
				result = await runConnectionTest();
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Connection test failed';
				testResult = { success: false, error: message, loading: false };
				pendingTestError = message;
				saveConfirmOpen = true;
				return;
			}
			applyTestResult(result);
			if (!result.success) {
				pendingTestError = result.error ?? 'Connection test failed';
				saveConfirmOpen = true;
				return;
			}
			await persistChanges();
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to update backend';
		} finally {
			saving = false;
		}
	}

	async function confirmSaveDespiteTest() {
		saveConfirmOpen = false;
		saving = true;
		saveError = null;
		try {
			await persistChanges();
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to update backend';
		} finally {
			saving = false;
		}
	}

	function cancelSaveConfirm() {
		saveConfirmOpen = false;
		pendingTestError = null;
	}

	async function testBackend() {
		testResult = { success: false, loading: true };
		try {
			const result = await runConnectionTest();
			applyTestResult(result);
		} catch (err) {
			testResult = {
				success: false,
				error: err instanceof Error ? err.message : 'Test failed',
				loading: false
			};
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Edit Backend — HAAI</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
	<PageHeader
		title="Edit Backend"
		subtitle={backend?.name ?? ''}
		parentHref="/backends"
		parentLabel="Backends"
	/>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm mb-4">
			{error}
		</div>
	{:else if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if backend}
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<form onsubmit={handleSubmit} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label for="backend-edit-name" class="block text-xs font-medium text-gray-400 mb-1">Name</label>
					<input id="backend-edit-name" bind:value={name} required class="input w-full" />
				</div>
				<div>
					<label for="backend-edit-provider" class="block text-xs font-medium text-gray-400 mb-1">Provider</label>
					<input id="backend-edit-provider" value={backend.provider} disabled class="input w-full opacity-60 cursor-not-allowed capitalize" />
				</div>
				<div>
					<label for="backend-edit-host" class="block text-xs font-medium text-gray-400 mb-1">Host</label>
					<input id="backend-edit-host" value={backend.host} disabled class="input w-full opacity-60 cursor-not-allowed" />
				</div>
				<div>
					<label for="backend-edit-url" class="block text-xs font-medium text-gray-400 mb-1">Base URL</label>
					<input id="backend-edit-url" bind:value={url} required class="input w-full" />
				</div>
				<div class="sm:col-span-2">
					<label for="backend-edit-api-key" class="block text-xs font-medium text-gray-400 mb-1">API Key</label>
					<input
						id="backend-edit-api-key"
						bind:value={apiKey}
						type="password"
						placeholder="Leave blank to keep current key"
						class="input w-full"
					/>
					<p class="mt-1 text-xs text-gray-500">
						Entering a key stores it on the server (abstraction mode) and uses it for health checks and
						upstream requests. Test Connection uses the values currently in this form, including an
						unsaved key.
					</p>
				</div>
				<div class="sm:col-span-2 flex items-center gap-3">
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

				{#if saveError}
					<div class="sm:col-span-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
						{saveError}
					</div>
				{/if}

				<div class="sm:col-span-2 flex flex-wrap gap-3 items-center">
					<button
						type="submit"
						disabled={saving || testResult?.loading === true}
						class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors"
					>
						{saving ? 'Saving…' : 'Save Changes'}
					</button>
					<button
						type="button"
						onclick={testBackend}
						disabled={testResult?.loading === true || saving}
						class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors"
					>
						{testResult?.loading ? 'Testing…' : 'Test Connection'}
					</button>
					{#if testResult && !testResult.loading}
						{#if testResult.success}
							<span class="text-sm text-green-400">{testResult.latency_ms}ms ✓</span>
						{:else}
							<span class="text-sm text-red-400">{testResult.error ?? 'Test failed'}</span>
						{/if}
					{/if}
					<a
						href="/backends"
						class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors"
					>
						Cancel
					</a>
				</div>
			</form>
		</div>
	{/if}
</div>

<Modal
	open={saveConfirmOpen}
	title="Connection test failed"
	onclose={cancelSaveConfirm}
>
	<p class="text-sm text-gray-300">
		The connection test did not succeed with the current form settings. Save these changes anyway?
	</p>
	{#if pendingTestError}
		<pre
			class="mt-3 whitespace-pre-wrap break-words rounded-lg bg-black/40 border border-gray-800 px-3 py-2 text-xs text-red-300 font-mono"
		>{pendingTestError}</pre>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-sm btn-secondary" onclick={cancelSaveConfirm} disabled={saving}>
			Cancel
		</button>
		<button type="button" class="btn btn-sm btn-primary" onclick={confirmSaveDespiteTest} disabled={saving}>
			{saving ? 'Saving…' : 'Save anyway'}
		</button>
	{/snippet}
</Modal>

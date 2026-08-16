<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api.js';
	import InfoTip from '$lib/components/InfoTip.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let name = $state('');
	let provider = $state('openai');
	let host = $state('');
	let url = $state('');
	let apiKey = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);
	let testResult = $state<{
		success: boolean;
		latency_ms?: number;
		error?: string;
		loading: boolean;
	} | null>(null);
	let saveConfirmOpen = $state(false);
	let pendingTestError = $state<string | null>(null);

	const canTest = $derived(url.trim().length > 0);

	function draftTestPayload(): { url: string; api_key?: string } {
		const payload: { url: string; api_key?: string } = { url: url.trim() };
		if (apiKey) payload.api_key = apiKey;
		return payload;
	}

	function applyTestResult(result: {
		success: boolean;
		latency_ms?: number;
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
	}

	async function runConnectionTest() {
		if (!canTest) {
			throw new Error('Base URL is required to test the connection');
		}
		return api.testBackendDraft(draftTestPayload());
	}

	async function persistBackend() {
		await api.addBackend({
			name,
			provider,
			host,
			url,
			...(apiKey ? { api_key: apiKey } : {})
		});
		goto('/backends');
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = null;
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
			await persistBackend();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to add backend';
		} finally {
			loading = false;
		}
	}

	async function confirmSaveDespiteTest() {
		saveConfirmOpen = false;
		loading = true;
		error = null;
		try {
			await persistBackend();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to add backend';
		} finally {
			loading = false;
		}
	}

	function cancelSaveConfirm() {
		saveConfirmOpen = false;
		pendingTestError = null;
	}

	async function testBackend() {
		if (!canTest) return;
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
</script>

<svelte:head>
	<title>New Backend — AiVM</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
	<PageHeader
		title="New Backend"
		subtitle="Connect a new LLM backend"
		parentHref="/backends"
		parentLabel="Backends"
	/>

	<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
		<form onsubmit={handleSubmit} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div>
				<label for="backend-new-name" class="block text-xs font-medium text-gray-400 mb-1">Name *</label>
				<input id="backend-new-name" bind:value={name} required placeholder="my-backend" class="input w-full" />
			</div>
			<div>
				<label for="backend-new-provider" class="block text-xs font-medium text-gray-400 mb-1">Provider *</label>
				<select id="backend-new-provider" bind:value={provider} class="input w-full">
					<option value="openai">OpenAI</option>
					<option value="anthropic">Anthropic</option>
					<option value="ollama">Ollama</option>
					<option value="other">Other</option>
				</select>
			</div>
			<div>
				<div class="mb-1 flex items-center gap-1.5">
					<label for="backend-host" class="text-xs font-medium text-gray-400">Host *</label>
					<InfoTip
						label="What is Host?"
						text="A short label for this backend instance (e.g. bob or my-laptop). It appears in model IDs like qwen3.5-35b:bob:lmstudio so you can tell apart the same model on different machines. This is not the network address — use Base URL for that."
					/>
				</div>
				<input id="backend-host" bind:value={host} required placeholder="my-laptop" class="input w-full" />
			</div>
			<div>
				<label for="backend-new-url" class="block text-xs font-medium text-gray-400 mb-1">Base URL *</label>
				<input
					id="backend-new-url"
					bind:value={url}
					required
					placeholder="http://192.168.1.100:1234"
					class="input w-full"
				/>
			</div>
			<div class="sm:col-span-2">
				<label for="backend-new-api-key" class="block text-xs font-medium text-gray-400 mb-1">API Key</label>
				<input
					id="backend-new-api-key"
					bind:value={apiKey}
					type="password"
					placeholder="sk-…"
					class="input w-full"
				/>
				<p class="mt-1 text-xs text-gray-500">
					Test Connection uses the Base URL and API key currently in this form.
				</p>
			</div>

			{#if error}
				<div class="sm:col-span-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
					{error}
				</div>
			{/if}

			<div class="sm:col-span-2 flex flex-wrap gap-3 items-center">
				<button
					type="submit"
					disabled={loading || testResult?.loading === true}
					class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors"
				>
					{loading ? 'Adding…' : 'Add Backend'}
				</button>
				<button
					type="button"
					onclick={testBackend}
					disabled={!canTest || testResult?.loading === true || loading}
					class="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 font-medium rounded-lg text-sm transition-colors"
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
</div>

<Modal open={saveConfirmOpen} title="Connection test failed" onclose={cancelSaveConfirm}>
	<p class="text-sm text-gray-300">
		The connection test did not succeed with the current form settings. Add this backend anyway?
	</p>
	{#if pendingTestError}
		<pre
			class="mt-3 whitespace-pre-wrap break-words rounded-lg bg-black/40 border border-gray-800 px-3 py-2 text-xs text-red-300 font-mono"
		>{pendingTestError}</pre>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-sm btn-secondary" onclick={cancelSaveConfirm} disabled={loading}>
			Cancel
		</button>
		<button type="button" class="btn btn-sm btn-primary" onclick={confirmSaveDespiteTest} disabled={loading}>
			{loading ? 'Adding…' : 'Add anyway'}
		</button>
	{/snippet}
</Modal>

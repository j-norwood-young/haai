<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api.js';
	import type { Hook } from '$lib/api.js';
	import PageHeader from '$lib/components/PageHeader.svelte';

	const id = $derived(page.params.id!);

	let hook = $state<Hook | null>(null);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let testResult = $state<{ success: boolean; error?: string; loading: boolean } | null>(null);

	let name = $state('');
	let enabled = $state(true);

	async function load() {
		loading = true;
		error = null;
		try {
			hook = await api.getHook(id);
			name = hook.name;
			enabled = hook.enabled;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load hook';
		} finally {
			loading = false;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		saveError = null;
		try {
			await api.updateHook(id, { name, enabled });
			goto('/hooks');
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to update hook';
		} finally {
			saving = false;
		}
	}

	async function testHook() {
		testResult = { success: false, loading: true };
		try {
			const result = await api.testHook(id);
			testResult = { ...result, loading: false };
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
	<title>Edit Hook — HAAI</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
	<PageHeader
		title="Edit Hook"
		subtitle={hook?.name ?? ''}
		parentHref="/hooks"
		parentLabel="Hooks"
	/>

	{#if error}
		<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm mb-4">{error}</div>
	{:else if loading}
		<div class="flex items-center justify-center py-20 text-gray-500">Loading…</div>
	{:else if hook}
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
			<form onsubmit={handleSubmit} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Name</label>
					<input bind:value={name} required class="input w-full" />
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Type</label>
					<input value={hook.type} disabled class="input w-full opacity-60 cursor-not-allowed capitalize" />
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Trigger</label>
					<input value={hook.trigger} disabled class="input w-full opacity-60 cursor-not-allowed font-mono text-xs" />
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Target</label>
					<input value={hook.url ?? hook.module ?? '—'} disabled class="input w-full opacity-60 cursor-not-allowed text-xs" />
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
					<div class="sm:col-span-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{saveError}</div>
				{/if}

				<div class="sm:col-span-2 flex flex-wrap gap-3 items-center">
					<button type="submit" disabled={saving} class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors">
						{saving ? 'Saving…' : 'Save Changes'}
					</button>
					<button
						type="button"
						onclick={testHook}
						disabled={testResult?.loading}
						class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors"
					>
						{testResult?.loading ? 'Testing…' : 'Test Hook'}
					</button>
					{#if testResult && !testResult.loading}
						{#if testResult.success}
							<span class="text-sm text-green-400">✓ OK</span>
						{:else}
							<span class="text-sm text-red-400">{testResult.error ?? 'Test failed'}</span>
						{/if}
					{/if}
					<a href="/hooks" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors">Cancel</a>
				</div>
			</form>
		</div>
	{/if}
</div>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api.js';
	import PageHeader from '$lib/components/PageHeader.svelte';

	const hookType = $derived(page.url.searchParams.get('type') === 'internal' ? 'internal' : 'webhook');

	let name = $state('');
	let trigger = $state('request.complete');
	let url = $state('');
	let module = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	const triggers = [
		'request.start',
		'request.complete',
		'request.error',
		'key.suspended',
		'key.budget_exceeded',
		'backend.unhealthy'
	];

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = null;
		try {
			if (hookType === 'webhook') {
				await api.createHook({
					name,
					type: 'webhook',
					trigger,
					url,
					enabled: true
				});
			} else {
				await api.createHook({
					name,
					type: 'internal',
					trigger,
					module,
					enabled: true
				});
			}
			goto('/hooks');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create hook';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{hookType === 'webhook' ? 'New Webhook' : 'New Internal Hook'} — HAAI</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
	<PageHeader
		title={hookType === 'webhook' ? 'New Webhook' : 'New Internal Hook'}
		subtitle="React to platform events"
		parentHref="/hooks"
		parentLabel="Hooks"
	/>

	<div class="flex gap-2 mb-4">
		<a
			href="/hooks/new?type=webhook"
			class="px-3 py-1.5 text-sm rounded-lg transition-colors {hookType === 'webhook' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-800' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}"
		>
			Webhook
		</a>
		<a
			href="/hooks/new?type=internal"
			class="px-3 py-1.5 text-sm rounded-lg transition-colors {hookType === 'internal' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-800' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}"
		>
			Internal
		</a>
	</div>

	<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
		<form onsubmit={handleSubmit} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div>
				<label class="block text-xs font-medium text-gray-400 mb-1">Name *</label>
				<input bind:value={name} required placeholder={hookType === 'webhook' ? 'my-webhook' : 'budget-alerter'} class="input w-full" />
			</div>
			<div>
				<label class="block text-xs font-medium text-gray-400 mb-1">Trigger *</label>
				<select bind:value={trigger} class="input w-full">
					{#each triggers as t}<option value={t}>{t}</option>{/each}
				</select>
			</div>
			{#if hookType === 'webhook'}
				<div class="sm:col-span-2">
					<label class="block text-xs font-medium text-gray-400 mb-1">URL *</label>
					<input bind:value={url} required type="url" placeholder="https://example.com/webhook" class="input w-full" />
				</div>
			{:else}
				<div class="sm:col-span-2">
					<label class="block text-xs font-medium text-gray-400 mb-1">Module *</label>
					<input bind:value={module} required placeholder="hooks/budget_alert" class="input w-full" />
				</div>
			{/if}

			{#if error}
				<div class="sm:col-span-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</div>
			{/if}
			<div class="sm:col-span-2 flex gap-3">
				<button type="submit" disabled={loading} class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors">
					{loading ? 'Adding…' : hookType === 'webhook' ? 'Add Webhook' : 'Add Internal Hook'}
				</button>
				<a href="/hooks" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-colors">Cancel</a>
			</div>
		</form>
	</div>
</div>

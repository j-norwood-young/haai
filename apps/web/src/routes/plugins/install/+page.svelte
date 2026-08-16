<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api.js';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let source = $state('');
	let nameOverride = $state('');
	let installing = $state(false);
	let error = $state<string | null>(null);

	async function handleInstall(e: SubmitEvent) {
		e.preventDefault();
		if (!source.trim()) return;
		installing = true;
		error = null;
		try {
			const plugin = await api.installPlugin(source.trim(), nameOverride.trim() || undefined);
			goto(`/plugins/${plugin.id}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Installation failed';
		} finally {
			installing = false;
		}
	}
</script>

<svelte:head>
	<title>Install Plugin — HAAI</title>
</svelte:head>

<div class="p-6 max-w-2xl mx-auto space-y-4">
	<PageHeader
		title="Install Plugin"
		parentHref="/plugins"
		parentLabel="Plugins"
	/>

	<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
		<div>
			<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Source formats</h2>
			<ul class="text-xs text-gray-500 space-y-1 font-mono">
				<li><span class="text-gray-400">npm:</span> <code>npm:@scope/plugin-name@1.0.0</code></li>
				<li><span class="text-gray-400">url:</span> <code>https://example.com/plugin.js</code></li>
				<li><span class="text-gray-400">file:</span> <code>file:///absolute/path/to/plugin.js</code></li>
			</ul>
		</div>

		<form onsubmit={handleInstall} class="space-y-4">
			<div>
				<label for="plugin-source" class="block text-xs font-medium text-gray-400 mb-1">
					Source <span class="text-red-400">*</span>
				</label>
				<input
					id="plugin-source"
					bind:value={source}
					required
					placeholder="npm:my-plugin@1.0.0"
					class="input w-full"
					disabled={installing}
				/>
			</div>

			<div>
				<label for="plugin-name" class="block text-xs font-medium text-gray-400 mb-1">
					Name override <span class="text-gray-600">(optional)</span>
				</label>
				<input
					id="plugin-name"
					bind:value={nameOverride}
					placeholder="Leave blank to use name from manifest"
					class="input w-full"
					disabled={installing}
				/>
			</div>

			{#if error}
				<div class="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-400 text-sm">
					{error}
				</div>
			{/if}

			<div class="flex gap-3 items-center">
				<button
					type="submit"
					disabled={installing || !source.trim()}
					class="btn btn-primary btn-md"
				>
					{installing ? 'Installing…' : 'Install Plugin'}
				</button>
				<a href="/plugins" class="btn btn-secondary btn-md">Cancel</a>
			</div>
		</form>
	</div>
</div>

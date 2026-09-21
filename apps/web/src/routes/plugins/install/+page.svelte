<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { api, pluginInstallConflict, type ExamplePlugin, type PluginInstallConflict } from '$lib/api.js';
	import Modal from '$lib/components/Modal.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let source = $state('');
	let nameOverride = $state('');
	let installing = $state(false);
	let error = $state<string | null>(null);
	/** Set when the name is already in use — shown against the name field. */
	let nameError = $state<string | null>(null);
	/** Set when the plugin is a newer version of an installed one — awaits the user's confirmation. */
	let upgrade = $state<Extract<PluginInstallConflict, { code: 'upgrade_available' }> | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);
	let examples = $state<ExamplePlugin[]>([]);

	const selectedExample = $derived(examples.find((ex) => ex.source === source.trim()));

	onMount(async () => {
		try {
			examples = await api.getExamplePlugins();
		} catch {
			// Examples are a convenience — the manual source field still works without them
		}
	});

	async function install(confirmUpgrade = false) {
		if (!source.trim()) return;
		installing = true;
		error = null;
		nameError = null;
		let focusName = false;
		try {
			const plugin = await api.installPlugin(
				source.trim(),
				nameOverride.trim() || undefined,
				confirmUpgrade || undefined
			);
			goto(`/plugins/${plugin.id}`);
		} catch (err) {
			const conflict = pluginInstallConflict(err);
			if (conflict?.code === 'upgrade_available') {
				upgrade = conflict;
			} else if (conflict?.code === 'name_taken') {
				nameError = `A plugin named "${conflict.name}" is already installed. Choose a different name.`;
				focusName = true;
			} else {
				upgrade = null;
				error = err instanceof Error ? err.message : 'Installation failed';
			}
		} finally {
			installing = false;
		}
		// The field is disabled while installing, so it can only take focus once that's cleared
		if (focusName) {
			focusName = false;
			await tick();
			nameInput?.focus();
		}
	}

	function handleInstall(e: SubmitEvent) {
		e.preventDefault();
		install();
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
				<li><span class="text-gray-400">github:</span> <code>github:owner/repo</code></li>
				<li><span class="text-gray-400">local:</span> <code>local:/absolute/path/to/plugin-package</code></li>
			</ul>
		</div>

		{#if examples.length > 0}
			<div>
				<h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Example plugins</h2>
				<div class="grid gap-2" role="radiogroup" aria-label="Example plugins">
					{#each examples as example (example.id)}
						{@const selected = selectedExample?.id === example.id}
						<button
							type="button"
							role="radio"
							aria-checked={selected}
							disabled={installing}
							onclick={() => (source = selected ? '' : example.source)}
							class="text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-50 {selected
								? 'border-blue-500 bg-blue-900/20'
								: 'border-gray-800 bg-gray-950 hover:border-gray-600'}"
						>
							<div class="flex items-center gap-2">
								<span class="text-sm font-medium text-gray-200">{example.name}</span>
								{#if example.version}
									<span class="text-xs text-gray-500">v{example.version}</span>
								{/if}
								{#each example.hooks as hook (hook)}
									<span class="text-[10px] font-mono text-gray-400 bg-gray-800 rounded px-1.5 py-0.5">{hook}</span>
								{/each}
							</div>
							{#if example.description}
								<p class="text-xs text-gray-500 mt-0.5">{example.description}</p>
							{/if}
							{#if !example.built}
								<p class="text-xs text-amber-400 mt-1">
									Not built yet — run <code>pnpm build</code> first or installation will fail.
								</p>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

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
					bind:this={nameInput}
					bind:value={nameOverride}
					oninput={() => (nameError = null)}
					placeholder="Leave blank to use name from manifest"
					class="input w-full {nameError ? 'border-red-600' : ''}"
					aria-invalid={nameError ? 'true' : undefined}
					aria-describedby={nameError ? 'plugin-name-error' : undefined}
					disabled={installing}
				/>
				{#if nameError}
					<p id="plugin-name-error" class="text-xs text-red-400 mt-1">{nameError}</p>
				{/if}
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

<Modal open={upgrade !== null} title="Upgrade plugin?" onclose={() => (upgrade = null)}>
	{#if upgrade}
		<p class="text-sm text-gray-300">
			<span class="font-medium text-gray-100">{upgrade.name}</span> is already installed
			{#if upgrade.currentVersion}(v{upgrade.currentVersion}){/if}. Upgrade it to
			{#if upgrade.newVersion}v{upgrade.newVersion}{:else}the new version{/if}?
		</p>
		<p class="text-xs text-gray-500 mt-2">
			Its bindings and their settings are kept. To install it alongside the existing plugin instead, cancel
			and choose a different name.
		</p>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-secondary btn-md" onclick={() => (upgrade = null)} disabled={installing}>
			Cancel
		</button>
		<button
			type="button"
			class="btn btn-primary btn-md"
			disabled={installing}
			onclick={async () => {
				await install(true);
				upgrade = null;
			}}
		>
			{installing ? 'Upgrading…' : 'Upgrade'}
		</button>
	{/snippet}
</Modal>

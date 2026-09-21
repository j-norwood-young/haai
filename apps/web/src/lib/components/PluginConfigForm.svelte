<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { ConfigSchema, AvailableModel, Backend } from '$lib/api.js';

	interface Props {
		configSchema: ConfigSchema | null;
		config: Record<string, unknown>;
	}

	let { configSchema, config = $bindable({}) }: Props = $props();

	let availableModels = $state<AvailableModel[]>([]);
	let backends = $state<Backend[]>([]);
	let resourcesLoaded = $state(false);

	const fields = $derived(
		configSchema
			? Object.entries(configSchema).map(([key, field]) => ({ key, field }))
			: []
	);

	const needsModels = $derived(fields.some((f) => f.field.type === 'model'));
	const needsBackends = $derived(fields.some((f) => f.field.type === 'backend'));

	onMount(async () => {
		const promises: Promise<unknown>[] = [];

		if (needsModels) {
			promises.push(
				api.getAvailableModels().then((res) => {
					availableModels = res.models;
				})
			);
		}

		if (needsBackends) {
			promises.push(
				api.getBackends().then((b) => {
					backends = b;
				})
			);
		}

		await Promise.all(promises);
		resourcesLoaded = true;

		// Set defaults for any unset fields
		if (configSchema) {
			const updated = { ...config };
			for (const [key, field] of Object.entries(configSchema)) {
				if (updated[key] === undefined && field.default !== undefined) {
					updated[key] = field.default;
				}
			}
			config = updated;
		}
	});

	function setValue(key: string, value: unknown) {
		config = { ...config, [key]: value };
	}
</script>

{#if fields.length > 0}
	<div class="space-y-4">
		{#each fields as { key, field } (key)}
			<div>
				<label for="cfg-{key}" class="block text-xs font-medium text-gray-300 mb-1">
					{field.label}
					{#if field.required}
						<span class="text-red-400 ml-0.5">*</span>
					{/if}
				</label>

				{#if field.description}
					<p class="text-xs text-gray-500 mb-1.5">{field.description}</p>
				{/if}

				{#if field.type === 'text'}
					<textarea
						id="cfg-{key}"
						rows="3"
						class="input resize-y"
						value={String(config[key] ?? '')}
						oninput={(e) => setValue(key, (e.currentTarget as HTMLTextAreaElement).value)}
					></textarea>
				{:else if field.type === 'number'}
					<input
						id="cfg-{key}"
						type="number"
						class="input"
						min={field.min}
						max={field.max}
						value={config[key] !== undefined ? Number(config[key]) : ''}
						oninput={(e) => setValue(key, (e.currentTarget as HTMLInputElement).valueAsNumber)}
					/>
				{:else if field.type === 'boolean'}
					{@const checked = Boolean(config[key] ?? field.default ?? false)}
					<button
						id="cfg-{key}"
						type="button"
						onclick={() => setValue(key, !checked)}
						class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none"
						class:bg-cyan-500={checked}
						class:bg-gray-700={!checked}
						role="switch"
						aria-checked={checked}
						aria-label={field.label}
					>
						<span
							class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
							class:translate-x-4={checked}
							class:translate-x-0={!checked}
						></span>
					</button>
				{:else if field.type === 'select'}
					<select
						id="cfg-{key}"
						class="input"
						value={String(config[key] ?? field.default ?? '')}
						onchange={(e) => setValue(key, (e.currentTarget as HTMLSelectElement).value)}
					>
						{#if !field.required}
							<option value="">— none —</option>
						{/if}
						{#each field.options ?? [] as opt (opt)}
							<option value={opt}>{opt}</option>
						{/each}
					</select>
				{:else if field.type === 'secret'}
					<input
						id="cfg-{key}"
						type="password"
						class="input"
						autocomplete="new-password"
						value={String(config[key] ?? '')}
						oninput={(e) => setValue(key, (e.currentTarget as HTMLInputElement).value)}
					/>
				{:else if field.type === 'model'}
					{#if !resourcesLoaded}
						<div class="input text-gray-500 text-sm">Loading models…</div>
					{:else}
						<select
							id="cfg-{key}"
							class="input"
							value={String(config[key] ?? '')}
							onchange={(e) => setValue(key, (e.currentTarget as HTMLSelectElement).value)}
						>
							{#if !field.required}
								<option value="">— none —</option>
							{/if}
							{#each availableModels as m (m.id)}
								<option value={m.id}>
									{m.id}{m.backendName ? ` (${m.backendName})` : ''}
								</option>
							{/each}
						</select>
					{/if}
				{:else if field.type === 'backend'}
					{#if !resourcesLoaded}
						<div class="input text-gray-500 text-sm">Loading backends…</div>
					{:else}
						<select
							id="cfg-{key}"
							class="input"
							value={String(config[key] ?? '')}
							onchange={(e) => setValue(key, (e.currentTarget as HTMLSelectElement).value)}
						>
							{#if !field.required}
								<option value="">— none —</option>
							{/if}
							{#each backends as b (b.id)}
								<option value={b.id}>{b.name}</option>
							{/each}
						</select>
					{/if}
				{:else}
					<!-- string | default -->
					<input
						id="cfg-{key}"
						type="text"
						class="input"
						value={String(config[key] ?? '')}
						oninput={(e) => setValue(key, (e.currentTarget as HTMLInputElement).value)}
					/>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<script lang="ts">
	import Modal from './Modal.svelte';
	import {
		healthBadgeClass,
		mappingReasonLabel,
		type VModelHealthDetails
	} from '$lib/backend-health.js';

	interface Props {
		open: boolean;
		vmodel: VModelHealthDetails | null;
		onclose: () => void;
	}

	let { open, vmodel, onclose }: Props = $props();

	const title = $derived(vmodel ? `${vmodel.name} health` : 'V-model health');

	const checkedLabel = $derived.by(() => {
		if (!vmodel?.checked_at) return null;
		const date =
			typeof vmodel.checked_at === 'number'
				? new Date(vmodel.checked_at)
				: new Date(vmodel.checked_at);
		if (Number.isNaN(date.getTime())) return null;
		return date.toLocaleString();
	});
</script>

<Modal {open} {title} onclose={onclose}>
	{#if vmodel}
		<div class="space-y-4 text-sm">
			<div class="flex items-center justify-between gap-3">
				<div>
					<p class="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Status</p>
					<span class={healthBadgeClass(vmodel.health)}>{vmodel.health}</span>
				</div>
				{#if checkedLabel}
					<div class="text-right">
						<p class="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Checked</p>
						<p class="text-[var(--color-text)]">{checkedLabel}</p>
					</div>
				{/if}
			</div>

			<div>
				<p class="text-[var(--color-text-muted)] text-xs uppercase tracking-wider mb-1">Model ID</p>
				<p class="text-[var(--color-text)] font-mono text-xs">{vmodel.modelId}</p>
			</div>

			{#if vmodel.error}
				<div class="rounded-lg bg-red-900/20 border border-red-800/50 px-3 py-2 text-red-300 text-sm">
					{vmodel.error}
				</div>
			{/if}

			<div>
				<p class="text-[var(--color-text-muted)] text-xs uppercase tracking-wider mb-2">Mappings</p>
				{#if vmodel.mappings.length === 0}
					<p class="text-[var(--color-text-subtle)]">No backends configured</p>
				{:else}
					<ul class="space-y-2">
						{#each vmodel.mappings as mapping (mapping.id)}
							<li
								class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3 py-2"
							>
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<p class="text-[var(--color-text)] truncate">{mapping.backendName}</p>
										<p class="text-xs text-[var(--color-text-subtle)] font-mono truncate">
											{mapping.backendModelId}
										</p>
									</div>
									{#if mapping.available === true}
										<span class="badge badge-green shrink-0">Available</span>
									{:else if mapping.available === false}
										<span class="badge badge-red shrink-0">Unavailable</span>
									{:else}
										<span class="badge badge-gray shrink-0">Unknown</span>
									{/if}
								</div>
								{#if mapping.available === false}
									<p class="text-xs text-red-300/90 mt-1">
										{mappingReasonLabel(mapping.reason, mapping.backendModelId)}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</Modal>

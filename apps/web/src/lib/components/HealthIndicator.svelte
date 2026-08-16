<script lang="ts">
	import BackendHealthDetailsModal from './BackendHealthDetailsModal.svelte';
	import {
		hasHealthDetails,
		healthBadgeClass,
		type BackendHealthDetails,
		type BackendHealthEntry,
		type BackendHealthLevel
	} from '$lib/backend-health.js';
	import { backendHealthState } from '$lib/backend-health-state.svelte.js';

	interface Props {
		level: BackendHealthLevel;
		summary: string;
		backends: BackendHealthEntry[];
		align?: 'left' | 'right';
	}

	let { level, summary, backends, align = 'right' }: Props = $props();

	let open = $state(false);
	let healthDetails = $state<BackendHealthDetails | null>(null);

	function toggleTooltip() {
		open = !open;
	}

	function closeTooltip() {
		open = false;
	}

	function openHealthDetails(backend: BackendHealthEntry, event: MouseEvent) {
		event.stopPropagation();
		if (!hasHealthDetails(backend.health)) return;
		open = false;
		const details: BackendHealthDetails = {
			id: backend.id,
			name: backend.name,
			health: backend.health
		};
		if (backend.latency_ms != null) details.latency_ms = backend.latency_ms;
		if (backend.error) details.error = backend.error;
		if (backend.checked_at != null) details.checked_at = backend.checked_at;
		healthDetails = details;
	}

	function closeHealthDetails() {
		healthDetails = null;
	}

	function onHealthUpdated(result: {
		id: string;
		health: 'healthy' | 'degraded' | 'unhealthy';
		latency_ms?: number;
		error?: string;
	}) {
		void backendHealthState.refresh();
		if (healthDetails?.id !== result.id) return;
		if (!hasHealthDetails(result.health)) {
			healthDetails = null;
			return;
		}
		const details: BackendHealthDetails = {
			id: result.id,
			name: healthDetails.name,
			health: result.health,
			checked_at: Date.now()
		};
		if (result.latency_ms !== undefined) details.latency_ms = result.latency_ms;
		if (result.error) details.error = result.error;
		healthDetails = details;
	}
</script>

<svelte:window
	onclick={() => {
		if (!healthDetails) closeTooltip();
	}}
/>

<div class="relative inline-flex items-center">
	<button
		type="button"
		class={`health-dot health-dot--${level}`}
		aria-label={summary}
		aria-expanded={open}
		onclick={(event) => {
			event.stopPropagation();
			toggleTooltip();
		}}
	></button>

	{#if open}
		<div class={`health-tooltip health-tooltip--${level} health-tooltip--align-${align}`} role="tooltip">
			<div class="health-tooltip__header">
				<span class={`health-tooltip__icon health-tooltip__icon--${level}`} aria-hidden="true"></span>
				<span class="health-tooltip__title">{summary}</span>
			</div>

			{#if backends.length > 0}
				<ul class="health-tooltip__list">
					{#each backends as backend (backend.id)}
						<li class="health-tooltip__row">
							<span class="health-tooltip__name">{backend.name}</span>
							{#if hasHealthDetails(backend.health)}
								<button
									type="button"
									class="{healthBadgeClass(backend.health)} health-tooltip__status-btn"
									onclick={(event) => openHealthDetails(backend, event)}
									title="View health details"
								>
									{backend.label}
								</button>
							{:else}
								<span class={healthBadgeClass(backend.health)}>{backend.label}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="health-tooltip__empty">No enabled backends configured</p>
			{/if}
		</div>
	{/if}
</div>

<BackendHealthDetailsModal
	open={healthDetails != null}
	backend={healthDetails}
	onclose={closeHealthDetails}
	onupdated={onHealthUpdated}
/>

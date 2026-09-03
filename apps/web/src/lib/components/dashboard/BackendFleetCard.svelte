<script lang="ts">
	import StatusDot from '$lib/components/charts/StatusDot.svelte';
	import Sparkline from '$lib/components/charts/Sparkline.svelte';
	import UtilizationBar from '$lib/components/charts/UtilizationBar.svelte';
	import BackendModelsModal from '$lib/components/BackendModelsModal.svelte';
	import { live } from '$lib/dashboard/live-state.svelte.js';
	import { api } from '$lib/api.js';
	import type { BackendHealth, Backend } from '$lib/api.js';
	import { relativeTime } from '$lib/format.js';

	interface Props {
		backends: BackendHealth[];
		backendDetails: Backend[];
		onrefresh: () => void;
	}

	let { backends, backendDetails, onrefresh }: Props = $props();

	let testingIds = $state(new Set<string>());
	let modalBackend: Pick<Backend, 'id' | 'name' | 'host' | 'provider'> | null = $state(null);
	let modelsCount = $state(new Map<string, number>());

	// Models loaded per backend (from /available-models), refreshed when the fleet changes.
	let loadModelsSeq = 0;
	$effect(() => {
		const ids = backendDetails.map((b) => b.id).join(',');
		void (async () => {
			const seq = ++loadModelsSeq;
			try {
				const res = await api.getAvailableModels();
				if (seq !== loadModelsSeq) return;
				const next = new Map<string, number>();
				for (const m of res.models) {
					if (m.type === 'backend-model' && m.backendId) {
						next.set(m.backendId, (next.get(m.backendId) ?? 0) + 1);
					}
				}
				modelsCount = next;
			} catch {
				// Model counts are best-effort
			}
		})();
	});

	const merged = $derived(
		backends.map((b) => {
			const detail = backendDetails.find((d) => d.id === b.id);
			const liveState = live.backends.get(b.id);
			return { summary: b, detail, live: liveState };
		})
	);

	function healthBadge(health: string): string {
		switch (health) {
			case 'healthy':
				return 'badge badge-green';
			case 'degraded':
				return 'badge badge-yellow';
			case 'unhealthy':
				return 'badge badge-red';
			default:
				return 'badge badge-gray';
		}
	}

	function circuitBadge(circuit: string | undefined): string {
		switch (circuit) {
			case 'open':
				return 'badge badge-red animate-pulse';
			case 'half-open':
				return 'badge badge-yellow';
			default:
				return 'badge badge-gray';
		}
	}

	async function test(id: string) {
		const next = new Set(testingIds);
		next.add(id);
		testingIds = next;
		try {
			await api.testBackend(id);
			onrefresh();
		} finally {
			const cleanup = new Set(testingIds);
			cleanup.delete(id);
			testingIds = cleanup;
		}
	}

	function probeSparkline(backendId: string): number[] {
		return live.backends
			.get(backendId)
			?.probes.slice(-120)
			.map((p) => p.latencyMs) ?? [];
	}

	function maxConcurrencyFor(backendId: string): number | undefined {
		return live.snapshot?.backends.find((b) => b.backendId === backendId)?.max_concurrency;
	}
</script>

<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="backend-fleet">
	{#each merged as entry (entry.summary.id)}
		{@const liveState = entry.live}
		<div class="card p-4 flex flex-col gap-3">
			<!-- Header -->
			<div class="flex items-center gap-2">
				<StatusDot status={entry.summary.health} pulse={entry.summary.health === 'healthy'} />
				<span class="font-medium text-[var(--color-text)] truncate">{entry.summary.name}</span>
				{#if entry.detail?.provider}
					<span class="text-xs text-[var(--color-text-subtle)] shrink-0">{entry.detail.provider}</span>
				{/if}
				<span class="ml-auto {healthBadge(entry.summary.health)} shrink-0">{entry.summary.health}</span>
				{#if entry.summary.enabled === false}
					<span class="badge badge-gray shrink-0">disabled</span>
				{/if}
			</div>

			<!-- Probe latency -->
			<div>
				<div class="flex items-center justify-between text-xs mb-1">
					<span class="text-[var(--color-text-subtle)]">Probe latency</span>
					<span class="text-[var(--color-text-muted)] tabular-nums">
						{#if liveState && liveState.probes.length > 0}
							{liveState.probes[liveState.probes.length - 1]!.latencyMs}ms · {live.uptimePct(entry.summary.id) != null ? `${(live.uptimePct(entry.summary.id)! * 100).toFixed(0)}% up` : ''}
						{:else if entry.summary.latency_ms != null}
							{entry.summary.latency_ms}ms
						{:else}
							—
						{/if}
					</span>
				</div>
				<div class="h-7">
					<Sparkline
						values={probeSparkline(entry.summary.id)}
						color="#fbbf24"
						ariaLabel="Probe latency history for {entry.summary.name}"
					/>
				</div>
				<div class="flex justify-between mt-0.5 text-[10px] text-[var(--color-text-subtle)]">
					<span>
						{liveState?.probes.length ?? 0} probes
					</span>
					<span>
						{#if entry.summary.checked_at}
							checked {relativeTime(entry.summary.checked_at)}
						{:else}
							not checked
						{/if}
					</span>
				</div>
			</div>

			<!-- Concurrency -->
			<UtilizationBar
				value={liveState?.concurrency ?? 0}
				max={maxConcurrencyFor(entry.summary.id)}
				label="Concurrency"
			/>

			<!-- Circuit + models -->
			<div class="flex items-center gap-2 text-xs">
				<span class="{circuitBadge(liveState?.circuit ?? 'closed')}">
					{liveState?.circuit ?? 'closed'}
				</span>
				{#if entry.detail}
					<button
						type="button"
						class="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
						onclick={() => (modalBackend = entry.detail!)}
					>
						{modelsCount.get(entry.summary.id) ?? 0} models
					</button>
				{/if}
			</div>

			{#if entry.summary.error}
				<p class="text-xs text-red-400 truncate" title={entry.summary.error}>{entry.summary.error}</p>
			{/if}

			<!-- Actions -->
			<div class="flex items-center gap-2 mt-auto pt-1">
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					disabled={testingIds.has(entry.summary.id)}
					onclick={() => test(entry.summary.id)}
				>
					{#if testingIds.has(entry.summary.id)}
						Testing…
					{:else}
						Test
					{/if}
				</button>
				<a href="/backends" class="btn btn-secondary btn-sm">Details</a>
				<a href="/analytics?backendId={entry.summary.id}" class="btn btn-secondary btn-sm">Metrics</a>
			</div>
		</div>
	{/each}
</div>

<BackendModelsModal
	open={modalBackend != null}
	backend={modalBackend}
	onclose={() => (modalBackend = null)}
/>

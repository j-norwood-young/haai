<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		/** Called when the user clicks Reveal; should return the secret string. */
		fetchSecret: () => Promise<string>;
		/** Shown when the secret cannot be retrieved (e.g. show-once keys). */
		unavailableLabel?: string;
		/** Whether this key can be retrieved from the server. */
		retrievable?: boolean;
		/** Optional inline secret (e.g. immediately after creation). */
		initialSecret?: string | null;
		/** Open the reveal modal automatically (e.g. right after key creation). */
		autoOpen?: boolean;
		/** Modal title when the secret is shown. */
		modalTitle?: string;
		class?: string;
	}

	let {
		fetchSecret,
		unavailableLabel = 'Not stored',
		retrievable = true,
		initialSecret = null,
		autoOpen = false,
		modalTitle = 'API Key',
		class: className = ''
	}: Props = $props();

	// Initial props only seed the state; later changes are handled by displaySecret/openModal.
	// svelte-ignore state_referenced_locally
	let modalOpen = $state(autoOpen && initialSecret != null);
	let secret = $state<string | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);

	const canReveal = $derived(retrievable || initialSecret != null);
	const displaySecret = $derived(secret ?? initialSecret);

	async function openModal() {
		if (initialSecret) {
			secret = initialSecret;
			modalOpen = true;
			return;
		}
		if (!retrievable) return;

		loading = true;
		error = null;
		try {
			secret = await fetchSecret();
			modalOpen = true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to reveal key';
		} finally {
			loading = false;
		}
	}

	function closeModal() {
		modalOpen = false;
		if (!initialSecret) {
			secret = null;
		}
		copied = false;
	}

	async function copy() {
		if (!displaySecret) return;
		await navigator.clipboard.writeText(displaySecret);
		copied = true;
		setTimeout(() => {
			copied = false;
		}, 1500);
	}
</script>

<div class={className}>
	{#if !canReveal}
		<span class="text-xs text-gray-500">{unavailableLabel}</span>
	{:else}
		<button
			type="button"
			onclick={openModal}
			disabled={loading}
			class="px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-md transition-colors whitespace-nowrap"
		>
			{loading ? 'Loading…' : 'Reveal'}
		</button>
	{/if}

	{#if error}
		<p class="text-xs text-red-400 mt-1">{error}</p>
	{/if}
</div>

<Modal open={modalOpen} title={modalTitle} onclose={closeModal}>
	<p class="text-xs text-gray-400 mb-3">
		Copy this key now. Anyone with access can use it to authenticate requests.
	</p>
	<div class="flex items-stretch gap-2">
		<code
			class="flex-1 min-w-0 font-mono text-xs text-cyan-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 break-all select-all"
		>
			{displaySecret ?? '…'}
		</code>
	</div>

	{#snippet footer()}
		<button
			type="button"
			onclick={copy}
			disabled={!displaySecret}
			class="px-3 py-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white rounded-md transition-colors min-w-30"
		>
			{copied ? 'Copied' : 'Copy to clipboard'}
		</button>
		<button
			type="button"
			onclick={closeModal}
			class="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors"
		>
			Close
		</button>
	{/snippet}
</Modal>

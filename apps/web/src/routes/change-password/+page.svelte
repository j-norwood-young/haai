<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api.js';
	import { auth } from '$lib/auth.svelte.js';
	import BrandLogo from '$lib/components/BrandLogo.svelte';

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	onMount(async () => {
		const ok = await auth.checkAuth();
		if (!ok) {
			goto('/login');
			return;
		}
		if (!auth.mustChangePassword) {
			goto('/');
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (newPassword !== confirmPassword) {
			error = 'New passwords do not match';
			return;
		}
		loading = true;
		error = null;
		try {
			const result = await api.changePassword(currentPassword, newPassword);
			auth.updateUser(result.user);
			goto('/');
		} catch (err) {
			if (err instanceof ApiError) {
				error = err.message;
			} else {
				error = 'Failed to change password';
			}
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Change password — HAAI</title>
</svelte:head>

<div class="min-h-screen bg-gray-950 flex items-center justify-center px-4">
	<div class="w-full max-w-sm">
		<div class="text-center mb-8">
			<div class="flex items-center justify-center mb-3">
				<BrandLogo variant="full" class="h-10 max-w-[12rem] text-cyan-400" />
			</div>
		</div>

		<div class="bg-gray-900 rounded-xl border border-amber-800/50 p-6 shadow-2xl">
			<div class="rounded-lg bg-amber-900/20 border border-amber-800 px-3 py-2 text-sm text-amber-300 mb-6">
				You must change your password before continuing.
			</div>

			<h2 class="text-lg font-semibold text-gray-100 mb-6">Set a new password</h2>

			<form onsubmit={handleSubmit} class="space-y-4">
				<div>
					<label for="current" class="block text-sm font-medium text-gray-300 mb-1.5">
						Current password
					</label>
					<input
						id="current"
						type="password"
						bind:value={currentPassword}
						required
						autocomplete="current-password"
						class="input w-full"
					/>
				</div>
				<div>
					<label for="new" class="block text-sm font-medium text-gray-300 mb-1.5">
						New password
					</label>
					<input
						id="new"
						type="password"
						bind:value={newPassword}
						required
						autocomplete="new-password"
						minlength={8}
						class="input w-full"
					/>
				</div>
				<div>
					<label for="confirm" class="block text-sm font-medium text-gray-300 mb-1.5">
						Confirm new password
					</label>
					<input
						id="confirm"
						type="password"
						bind:value={confirmPassword}
						required
						autocomplete="new-password"
						class="input w-full"
					/>
				</div>

				{#if error}
					<div class="rounded-lg bg-red-900/30 border border-red-800 px-3 py-2 text-sm text-red-400">
						{error}
					</div>
				{/if}

				<button
					type="submit"
					disabled={loading}
					class="w-full py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-semibold rounded-lg transition-colors"
				>
					{loading ? 'Saving…' : 'Change password and continue'}
				</button>
			</form>
		</div>
	</div>
</div>

<style>
	.input {
		background: #1f2937;
		border: 1px solid #374151;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
		color: #f3f4f6;
		font-size: 0.875rem;
		outline: none;
		width: 100%;
	}
	.input:focus {
		border-color: #06b6d4;
	}
</style>

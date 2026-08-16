<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth.svelte.js';
	import { isPasskeySupported, passkeysAvailableForUsername } from '$lib/passkeys.js';
	import BrandLogo from '$lib/components/BrandLogo.svelte';

	let username = $state('');
	let password = $state('');
	let totpCode = $state('');
	let submitting = $state(false);
	let passkeySupported = $state(false);
	let passkeysAvailable = $state(false);

	const showTotpStep = $derived(auth.pendingTotp !== null);

	onMount(() => {
		passkeySupported = isPasskeySupported();
	});

	$effect(() => {
		if (!passkeySupported || !username.trim()) {
			passkeysAvailable = false;
			return;
		}
		const currentUsername = username.trim();
		let cancelled = false;
		void passkeysAvailableForUsername(currentUsername).then((available) => {
			if (!cancelled && username.trim() === currentUsername) {
				passkeysAvailable = available;
			}
		});
		return () => {
			cancelled = true;
		};
	});

	async function afterAuth(user: { mustChangePassword?: boolean }) {
		if (user.mustChangePassword) {
			goto('/change-password');
		} else {
			goto('/');
		}
	}

	async function handleLogin(e: SubmitEvent) {
		e.preventDefault();
		submitting = true;
		const result = await auth.login(username, password);
		submitting = false;
		if (result && !result.requiresTotp) {
			await afterAuth(result.user);
		}
	}

	async function handleTotp(e: SubmitEvent) {
		e.preventDefault();
		submitting = true;
		const ok = await auth.verifyTotp(totpCode);
		submitting = false;
		if (ok && auth.user) {
			await afterAuth(auth.user);
		}
	}

	async function handlePasskeyLogin() {
		submitting = true;
		const user = await auth.loginWithPasskey(username.trim() || undefined);
		submitting = false;
		if (user) {
			await afterAuth(user);
		}
	}
</script>

<svelte:head>
	<title>Sign in — HAAI</title>
</svelte:head>

<!-- Decorative background -->
<div class="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
	<div class="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-cyan-500/5 blur-3xl"></div>
	<div class="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-violet-500/5 blur-3xl"></div>
</div>

<div class="min-h-screen bg-[var(--color-surface)] flex items-center justify-center px-4">
	<div class="w-full max-w-sm">
		<!-- Logo / branding -->
		<div class="text-center mb-8">
			<div class="flex items-center justify-center gap-2.5 mb-3">
				<BrandLogo variant="full" class="h-10 max-w-[12rem] text-cyan-400" />
			</div>
			<p class="text-[var(--color-text-muted)] text-sm">
				High Availability AI · LLM Reverse Proxy Admin
			</p>
		</div>

		<!-- Card -->
		<div
			class="bg-[var(--color-surface-2)] rounded-2xl border border-[var(--color-border-subtle)] p-7 shadow-2xl shadow-black/50"
		>
			{#if showTotpStep}
				<h2 class="text-lg font-semibold text-[var(--color-text)] mb-2">
					Two-factor authentication
				</h2>
				<p class="text-sm text-[var(--color-text-muted)] mb-6">
					Enter the 6-digit code from your authenticator app.
				</p>

				<form onsubmit={handleTotp} class="space-y-4">
					<div>
						<label for="totp" class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5">
							Verification code
						</label>
						<input
							id="totp"
							type="text"
							inputmode="numeric"
							pattern="[0-9]*"
							maxlength="6"
							bind:value={totpCode}
							required
							autocomplete="one-time-code"
							placeholder="000000"
							class="input tracking-widest text-center text-lg"
						/>
					</div>

					{#if auth.error}
						<div
							class="rounded-lg bg-red-900/20 border border-red-800/50 px-3 py-2 text-sm text-red-400 flex items-center gap-2"
						>
							<svg
								class="w-4 h-4 shrink-0"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path
									d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
								/>
							</svg>
							{auth.error}
						</div>
					{/if}

					<button
						type="submit"
						disabled={submitting || auth.loading}
						class="btn btn-primary btn-lg w-full mt-1"
					>
						{submitting ? 'Verifying…' : 'Verify'}
					</button>

					<button
						type="button"
						onclick={() => auth.cancelTotp()}
						class="w-full py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors flex items-center justify-center gap-1.5"
					>
						<svg
							class="w-3.5 h-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
						</svg>
						Back to sign in
					</button>
				</form>
			{:else}
				<h2 class="text-lg font-semibold text-[var(--color-text)] mb-6">Sign in to your account</h2>

				<form onsubmit={handleLogin} class="space-y-4">
					<div>
						<label
							for="username"
							class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
						>
							Username
						</label>
						<input
							id="username"
							type="text"
							bind:value={username}
							required
							autocomplete="username webauthn"
							placeholder="admin"
							class="input"
						/>
					</div>

					<div>
						<label
							for="password"
							class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
						>
							Password
						</label>
						<input
							id="password"
							type="password"
							bind:value={password}
							required
							autocomplete="current-password"
							placeholder="••••••••"
							class="input"
						/>
					</div>

					{#if auth.error}
						<div
							class="rounded-lg bg-red-900/20 border border-red-800/50 px-3 py-2 text-sm text-red-400 flex items-center gap-2"
						>
							<svg
								class="w-4 h-4 shrink-0"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path
									d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
								/>
							</svg>
							{auth.error}
						</div>
					{/if}

					<button
						type="submit"
						disabled={submitting || auth.loading}
						class="btn btn-primary btn-lg w-full mt-1"
					>
						{submitting ? 'Signing in…' : 'Sign in'}
					</button>
				</form>

				{#if passkeySupported}
					<div class="relative my-6">
						<div class="absolute inset-0 flex items-center" aria-hidden="true">
							<div class="w-full border-t border-[var(--color-border-subtle)]"></div>
						</div>
						<div class="relative flex justify-center text-xs uppercase">
							<span class="bg-[var(--color-surface-2)] px-2 text-[var(--color-text-subtle)]">or</span>
						</div>
					</div>

					<button
						type="button"
						onclick={handlePasskeyLogin}
						disabled={submitting || auth.loading || (Boolean(username.trim()) && !passkeysAvailable)}
						class="btn btn-secondary btn-lg w-full flex items-center justify-center gap-2"
					>
						<svg
							class="w-4 h-4 shrink-0"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path
								d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33"
							/>
						</svg>
						{submitting ? 'Waiting for passkey…' : 'Sign in with passkey'}
					</button>

					{#if username.trim() && !passkeysAvailable}
						<p class="mt-2 text-xs text-[var(--color-text-subtle)] text-center">
							No passkey registered for this account yet.
						</p>
					{/if}
				{/if}
			{/if}
		</div>
	</div>
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.svelte.js';
	import { isPasskeySupported, registerPasskey, passkeyErrorMessage } from '$lib/passkeys.js';

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let pwLoading = $state(false);
	let pwError = $state<string | null>(null);
	let pwSuccess = $state(false);

	let totpSetupSecret = $state<string | null>(null);
	let totpSetupUrl = $state<string | null>(null);
	let totpVerifyCode = $state('');
	let totpDisableCode = $state('');
	let totpLoading = $state(false);
	let totpError = $state<string | null>(null);
	let totpSuccess = $state(false);

	let newAdminTokenName = $state('');
	let createdAdminToken = $state<string | null>(null);
	let adminTokens = $state<
		Array<{ id: string; name: string; prefix: string; enabled: boolean }>
	>([]);
	let tokenLoading = $state(false);
	let tokenError = $state<string | null>(null);

	let passkeySupported = $state(false);
	let passkeys = $state<
		Array<{
			id: string;
			name: string;
			deviceType: string;
			backedUp: boolean;
			createdAt: number;
			lastUsedAt: number | null;
		}>
	>([]);
	let newPasskeyName = $state('');
	let passkeyLoading = $state(false);
	let passkeyError = $state<string | null>(null);
	let passkeySuccess = $state(false);

	let apiKeysShowOnce = $state(false);
	let settingsLoading = $state(true);
	let settingsSaving = $state(false);
	let settingsError = $state<string | null>(null);
	let settingsSuccess = $state(false);

	const isAdmin = $derived(auth.user?.role === 'admin');

	onMount(async () => {
		passkeySupported = isPasskeySupported();

		try {
			const settings = await api.getSettings();
			apiKeysShowOnce = settings.apiKeys.showOnce;
		} catch (err) {
			settingsError = err instanceof Error ? err.message : 'Failed to load settings';
		} finally {
			settingsLoading = false;
		}

		try {
			passkeys = await api.listPasskeys();
		} catch {
			// ignore
		}

		if (isAdmin) {
			try {
				adminTokens = await api.listAdminTokens();
			} catch {
				// ignore — may lack permission in edge cases
			}
		}
	});

	async function handleToggleShowOnce() {
		if (!isAdmin) return;
		settingsSaving = true;
		settingsError = null;
		settingsSuccess = false;
		const next = !apiKeysShowOnce;
		try {
			const settings = await api.updateSettings({ apiKeys: { showOnce: next } });
			apiKeysShowOnce = settings.apiKeys.showOnce;
			settingsSuccess = true;
		} catch (err) {
			settingsError = err instanceof Error ? err.message : 'Failed to update settings';
		} finally {
			settingsSaving = false;
		}
	}

	async function handleChangePassword(e: SubmitEvent) {
		e.preventDefault();
		if (newPassword !== confirmPassword) {
			pwError = 'New passwords do not match';
			return;
		}
		pwLoading = true;
		pwError = null;
		pwSuccess = false;
		try {
			const result = await api.changePassword(currentPassword, newPassword);
			auth.updateUser(result.user);
			pwSuccess = true;
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch (err) {
			pwError = err instanceof Error ? err.message : 'Failed to change password';
		} finally {
			pwLoading = false;
		}
	}

	async function handleStartTotpSetup() {
		totpLoading = true;
		totpError = null;
		totpSuccess = false;
		try {
			const result = await api.setupTotp();
			totpSetupSecret = result.secret;
			totpSetupUrl = result.otpauthUrl;
			totpVerifyCode = '';
		} catch (err) {
			totpError = err instanceof Error ? err.message : 'Failed to start 2FA setup';
		} finally {
			totpLoading = false;
		}
	}

	async function handleEnableTotp(e: SubmitEvent) {
		e.preventDefault();
		if (!totpSetupSecret) return;
		totpLoading = true;
		totpError = null;
		try {
			await api.enableTotp(totpSetupSecret, totpVerifyCode);
			totpSetupSecret = null;
			totpSetupUrl = null;
			totpVerifyCode = '';
			totpSuccess = true;
			if (auth.user) {
				auth.updateUser({ ...auth.user, totpEnabled: true });
			}
		} catch (err) {
			totpError = err instanceof Error ? err.message : 'Invalid verification code';
		} finally {
			totpLoading = false;
		}
	}

	async function handleDisableTotp(e: SubmitEvent) {
		e.preventDefault();
		totpLoading = true;
		totpError = null;
		try {
			await api.disableTotp(totpDisableCode);
			totpDisableCode = '';
			totpSuccess = true;
			if (auth.user) {
				auth.updateUser({ ...auth.user, totpEnabled: false });
			}
		} catch (err) {
			totpError = err instanceof Error ? err.message : 'Failed to disable 2FA';
		} finally {
			totpLoading = false;
		}
	}

	async function handleCreateAdminToken(e: SubmitEvent) {
		e.preventDefault();
		if (!newAdminTokenName.trim()) return;
		tokenLoading = true;
		tokenError = null;
		createdAdminToken = null;
		try {
			const result = await api.createAdminToken(newAdminTokenName.trim());
			createdAdminToken = result.token;
			newAdminTokenName = '';
			adminTokens = await api.listAdminTokens();
		} catch (err) {
			tokenError = err instanceof Error ? err.message : 'Failed to create token';
		} finally {
			tokenLoading = false;
		}
	}

	async function handleRevokeAdminToken(id: string) {
		tokenLoading = true;
		tokenError = null;
		try {
			await api.revokeAdminToken(id);
			adminTokens = await api.listAdminTokens();
		} catch (err) {
			tokenError = err instanceof Error ? err.message : 'Failed to revoke token';
		} finally {
			tokenLoading = false;
		}
	}

	async function handleAddPasskey() {
		if (!newPasskeyName.trim()) return;
		passkeyLoading = true;
		passkeyError = null;
		passkeySuccess = false;
		try {
			await registerPasskey(newPasskeyName.trim());
			newPasskeyName = '';
			passkeys = await api.listPasskeys();
			passkeySuccess = true;
		} catch (err) {
			passkeyError = passkeyErrorMessage(err);
		} finally {
			passkeyLoading = false;
		}
	}

	async function handleDeletePasskey(id: string) {
		passkeyLoading = true;
		passkeyError = null;
		try {
			await api.deletePasskey(id);
			passkeys = await api.listPasskeys();
		} catch (err) {
			passkeyError = passkeyErrorMessage(err);
		} finally {
			passkeyLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Settings — HAAI</title>
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-gray-100">Settings</h1>
		<p class="text-sm text-gray-400 mt-1">Admin configuration and server status</p>
	</div>

	<!-- Admin Info -->
	{#if auth.user}
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
			<h2 class="text-base font-semibold text-gray-100 mb-4">Account</h2>
			<div class="flex items-center gap-4">
				<div class="w-12 h-12 rounded-full bg-cyan-600 flex items-center justify-center text-xl font-bold">
					{auth.user.username.charAt(0).toUpperCase()}
				</div>
				<div>
					<p class="text-gray-100 font-medium">{auth.user.username}</p>
					<p class="text-sm text-gray-400">{auth.user.role}</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- API Keys (admin) -->
	{#if isAdmin}
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
			<h2 class="text-base font-semibold text-gray-100 mb-4">API Keys</h2>
			{#if settingsLoading}
				<p class="text-sm text-gray-500">Loading…</p>
			{:else}
				<div class="flex items-start justify-between gap-4">
					<div>
						<p class="text-sm text-gray-200">Show keys only once</p>
						<p class="text-xs text-gray-500 mt-1">
							When enabled, new API keys are shown at creation only and cannot be retrieved later.
							Existing retrievable keys are unaffected.
						</p>
					</div>
					<button
						type="button"
						onclick={handleToggleShowOnce}
						disabled={settingsSaving}
						class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50"
						class:bg-cyan-500={apiKeysShowOnce}
						class:bg-gray-700={!apiKeysShowOnce}
						role="switch"
						aria-checked={apiKeysShowOnce}
						aria-label="Show API keys only once"
					>
						<span
							class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
							class:translate-x-4={apiKeysShowOnce}
							class:translate-x-0={!apiKeysShowOnce}
						></span>
					</button>
				</div>
				{#if settingsError}
					<div class="mt-3 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
						{settingsError}
					</div>
				{/if}
				{#if settingsSuccess}
					<div class="mt-3 text-sm text-green-400 bg-green-900/20 border border-green-800 rounded-lg px-3 py-2">
						Settings saved.
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Two-factor authentication -->
	<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
		<h2 class="text-base font-semibold text-gray-100 mb-4">Two-factor authentication</h2>
		{#if auth.user?.totpEnabled}
			<p class="text-sm text-green-400 mb-4">2FA is enabled on your account.</p>
			<form onsubmit={handleDisableTotp} class="space-y-3 max-w-sm">
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Verification code</label>
					<input
						type="text"
						inputmode="numeric"
						maxlength="6"
						bind:value={totpDisableCode}
						required
						class="input w-full"
						placeholder="000000"
					/>
				</div>
				<button
					type="submit"
					disabled={totpLoading}
					class="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm"
				>
					Disable 2FA
				</button>
			</form>
		{:else if totpSetupSecret}
			<p class="text-sm text-gray-400 mb-3">
				Add this secret to your authenticator app, or open the setup URL.
			</p>
			<code class="block text-xs text-cyan-300 bg-gray-800 rounded-lg p-3 mb-3 break-all">{totpSetupSecret}</code>
			{#if totpSetupUrl}
				<p class="text-xs text-gray-500 mb-4 break-all">{totpSetupUrl}</p>
			{/if}
			<form onsubmit={handleEnableTotp} class="space-y-3 max-w-sm">
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Verification code</label>
					<input
						type="text"
						inputmode="numeric"
						maxlength="6"
						bind:value={totpVerifyCode}
						required
						class="input w-full"
						placeholder="000000"
					/>
				</div>
				<div class="flex gap-2">
					<button
						type="submit"
						disabled={totpLoading}
						class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-medium rounded-lg text-sm"
					>
						Enable 2FA
					</button>
					<button
						type="button"
						onclick={() => {
							totpSetupSecret = null;
							totpSetupUrl = null;
						}}
						class="px-4 py-2 text-gray-400 hover:text-gray-200 text-sm"
					>
						Cancel
					</button>
				</div>
			</form>
		{:else}
			<p class="text-sm text-gray-400 mb-4">
				Require a TOTP code from an authenticator app when signing in.
			</p>
			<button
				type="button"
				onclick={handleStartTotpSetup}
				disabled={totpLoading}
				class="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 font-medium rounded-lg text-sm"
			>
				Set up 2FA
			</button>
		{/if}
		{#if totpError}
			<div class="mt-3 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
				{totpError}
			</div>
		{/if}
		{#if totpSuccess}
			<div class="mt-3 text-sm text-green-400 bg-green-900/20 border border-green-800 rounded-lg px-3 py-2">
				Two-factor settings updated.
			</div>
		{/if}
	</div>

	<!-- Passkeys -->
	{#if passkeySupported}
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
			<h2 class="text-base font-semibold text-gray-100 mb-4">Passkeys</h2>
			<p class="text-sm text-gray-400 mb-4">
				Sign in with Touch ID, Face ID, Windows Hello, or a password manager like 1Password.
			</p>

			<div class="flex gap-2 mb-4 max-w-md">
				<input
					type="text"
					bind:value={newPasskeyName}
					placeholder="Passkey name (e.g. MacBook Touch ID)"
					class="input flex-1"
				/>
				<button
					type="button"
					onclick={handleAddPasskey}
					disabled={passkeyLoading || !newPasskeyName.trim()}
					class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-medium rounded-lg text-sm whitespace-nowrap"
				>
					Add passkey
				</button>
			</div>

			{#if passkeys.length > 0}
				<ul class="space-y-2">
					{#each passkeys as passkey (passkey.id)}
						<li class="flex items-center justify-between py-2 border-b border-gray-800 text-sm">
							<div>
								<span class="text-gray-200">{passkey.name}</span>
								<span class="text-gray-500 ml-2 text-xs">
									{passkey.deviceType}{passkey.backedUp ? ' · synced' : ''}
								</span>
							</div>
							<button
								type="button"
								onclick={() => handleDeletePasskey(passkey.id)}
								disabled={passkeyLoading}
								class="text-xs text-red-400 hover:text-red-300"
							>
								Remove
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-gray-500">No passkeys registered yet.</p>
			{/if}

			{#if passkeyError}
				<div class="mt-3 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
					{passkeyError}
				</div>
			{/if}
			{#if passkeySuccess}
				<div class="mt-3 text-sm text-green-400 bg-green-900/20 border border-green-800 rounded-lg px-3 py-2">
					Passkey added successfully.
				</div>
			{/if}
		</div>
	{/if}

	<!-- Admin API tokens (admin) -->
	{#if isAdmin}
		<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
			<h2 class="text-base font-semibold text-gray-100 mb-4">Admin API tokens</h2>
			<p class="text-xs text-gray-500 mb-4">
				Bearer tokens for CLI and automation (<code class="text-gray-400">haai-at-…</code>).
				Set <code class="text-gray-400">HAAI_ADMIN_TOKEN</code> or pass <code class="text-gray-400">-t</code> to the CLI.
			</p>

			<form onsubmit={handleCreateAdminToken} class="flex gap-2 mb-4 max-w-md">
				<input
					type="text"
					bind:value={newAdminTokenName}
					placeholder="Token name"
					required
					class="input flex-1"
				/>
				<button
					type="submit"
					disabled={tokenLoading}
					class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-medium rounded-lg text-sm whitespace-nowrap"
				>
					Create token
				</button>
			</form>

			{#if createdAdminToken}
				<div class="mb-4 text-sm text-amber-300 bg-amber-900/20 border border-amber-800 rounded-lg px-3 py-2">
					<p class="font-medium mb-1">Save this token — it won't be shown again:</p>
					<code class="text-xs break-all">{createdAdminToken}</code>
				</div>
			{/if}

			{#if adminTokens.length > 0}
				<ul class="space-y-2">
					{#each adminTokens as token (token.id)}
						<li class="flex items-center justify-between py-2 border-b border-gray-800 text-sm">
							<div>
								<span class="text-gray-200">{token.name}</span>
								<span class="text-gray-500 ml-2 font-mono text-xs">{token.prefix}…</span>
							</div>
							<button
								type="button"
								onclick={() => handleRevokeAdminToken(token.id)}
								disabled={tokenLoading}
								class="text-xs text-red-400 hover:text-red-300"
							>
								Revoke
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-gray-500">No admin tokens yet.</p>
			{/if}

			{#if tokenError}
				<div class="mt-3 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
					{tokenError}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Change Password -->
	<div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
		<h2 class="text-base font-semibold text-gray-100 mb-4">Change Password</h2>
		<form onsubmit={handleChangePassword} class="space-y-4 max-w-sm">
			<div>
				<label class="block text-xs font-medium text-gray-400 mb-1">Current Password</label>
				<input
					type="password"
					bind:value={currentPassword}
					required
					autocomplete="current-password"
					class="input w-full"
				/>
			</div>
			<div>
				<label class="block text-xs font-medium text-gray-400 mb-1">New Password</label>
				<input
					type="password"
					bind:value={newPassword}
					required
					autocomplete="new-password"
					minlength={8}
					class="input w-full"
				/>
			</div>
			<div>
				<label class="block text-xs font-medium text-gray-400 mb-1">Confirm New Password</label>
				<input
					type="password"
					bind:value={confirmPassword}
					required
					autocomplete="new-password"
					class="input w-full"
				/>
			</div>

			{#if pwError}
				<div class="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
					{pwError}
				</div>
			{/if}
			{#if pwSuccess}
				<div class="text-sm text-green-400 bg-green-900/20 border border-green-800 rounded-lg px-3 py-2">
					Password changed successfully.
				</div>
			{/if}

			<button
				type="submit"
				disabled={pwLoading}
				class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-white font-medium rounded-lg text-sm transition-colors"
			>
				{pwLoading ? 'Changing…' : 'Change Password'}
			</button>
		</form>
	</div>

	<!-- Server Links -->
	<div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
		<h2 class="text-base font-semibold text-gray-100 mb-4">Server</h2>
		<div class="space-y-3">
			<div class="flex items-center justify-between py-2 border-b border-gray-800">
				<div>
					<p class="text-sm text-gray-200">Prometheus Metrics</p>
					<p class="text-xs text-gray-500">Raw Prometheus-format metrics</p>
				</div>
				<a
					href="/metrics"
					target="_blank"
					class="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
				>
					Open →
				</a>
			</div>
			<div class="flex items-center justify-between py-2 border-b border-gray-800">
				<div>
					<p class="text-sm text-gray-200">Health Check</p>
					<p class="text-xs text-gray-500">Server liveness endpoint</p>
				</div>
				<a
					href="/health"
					target="_blank"
					class="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
				>
					Open →
				</a>
			</div>
			<div class="flex items-center justify-between py-2 border-b border-gray-800">
				<div>
					<p class="text-sm text-gray-200">Documentation</p>
					<p class="text-xs text-gray-500">Guides, configuration, and deployment</p>
				</div>
				<a
					href="/docs/"
					target="_blank"
					class="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
				>
					Open →
				</a>
			</div>
			<div class="flex items-center justify-between py-2">
				<div>
					<p class="text-sm text-gray-200">API Reference</p>
					<p class="text-xs text-gray-500">Interactive OpenAPI / Swagger UI</p>
				</div>
				<a
					href="/api/docs/"
					target="_blank"
					class="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
				>
					Open →
				</a>
			</div>
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
		transition: border-color 0.15s;
	}
	.input:focus {
		border-color: #06b6d4;
	}
	.input::placeholder {
		color: #6b7280;
	}
</style>

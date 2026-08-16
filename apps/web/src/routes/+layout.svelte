<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth.svelte.js';
	import { sse } from '$lib/sse.svelte.js';
	import { backendHealthState } from '$lib/backend-health-state.svelte.js';
	import HealthIndicator from '$lib/components/HealthIndicator.svelte';
	import LoadingScreen from '$lib/components/LoadingScreen.svelte';

	interface Props {
		children: import('svelte').Snippet;
	}
	const { children }: Props = $props();

	const isLoginPage = $derived(page.url.pathname === '/login');
	const isChangePasswordPage = $derived(page.url.pathname === '/change-password');
	const isPublicPage = $derived(isLoginPage || isChangePasswordPage);

	let booting = $state(true);
	let sidebarOpen = $state(false);
	const backendHealth = $derived(backendHealthState.snapshot);

	type NavItem = { href: string; label: string; paths: string[]; external?: boolean };

	const navItems: NavItem[] = [
		{
			href: '/',
			label: 'Dashboard',
			paths: [
				'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z'
			]
		},
		{
			href: '/backends',
			label: 'Backends',
			paths: [
				'M5.25 14.25h13.5M5.25 9.75h13.5M3.375 4.5C2.339 4.5 1.5 5.34 1.5 6.375V17.625c0 1.036.84 1.875 1.875 1.875h17.25c1.035 0 1.875-.84 1.875-1.875V6.375c0-1.036-.84-1.875-1.875-1.875H3.375Z'
			]
		},
		{
			href: '/vmodels',
			label: 'Virtual Models',
			paths: ['M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9']
		},
		{
			href: '/keys',
			label: 'API Keys',
			paths: [
				'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z'
			]
		},
		{
			href: '/hooks',
			label: 'Hooks',
			paths: ['m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z']
		},
		{
			href: '/plugins',
			label: 'Plugins',
			paths: [
				'M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z'
			]
		},
		{
			href: '/logs',
			label: 'Live Logs',
			paths: [
				'M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z'
			]
		},
		{
			href: '/analytics',
			label: 'Metrics',
			paths: [
				'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z'
			]
		},
		{
			href: '/docs/',
			label: 'Documentation',
			paths: [
				'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25'
			],
			external: true
		},
		{
			href: '/settings',
			label: 'Settings',
			paths: [
				'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z',
				'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'
			]
		}
	];

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}

	function closeSidebar() {
		sidebarOpen = false;
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	async function handleLogout() {
		sse.disconnect();
		backendHealthState.reset();
		await auth.logout();
		goto('/login');
	}

	onMount(async () => {
		if (isPublicPage) {
			booting = false;
			return;
		}
		try {
			const ok = await auth.checkAuth();
			if (!ok) {
				goto('/login');
				return;
			}
			if (auth.mustChangePassword && !isChangePasswordPage) {
				goto('/change-password');
				return;
			}
			sidebarOpen = false;
		} finally {
			booting = false;
		}
	});

	$effect(() => {
		void page.url.pathname;
		sidebarOpen = false;
	});

	$effect(() => {
		if (isPublicPage || booting || !auth.user) {
			sse.disconnect();
			return;
		}
		sse.connect();
	});

	$effect(() => {
		if (isPublicPage || booting || !auth.user) return;
		// Re-fetch when navigating so create/edit redirects refresh the sidebar
		// even if an SSE event was missed.
		void page.url.pathname;
		void backendHealthState.refresh();
	});

	$effect(() => {
		if (isPublicPage || !auth.user) return;
		const event = sse.latestEvent;
		if (event?.type === 'backend-health') {
			void backendHealthState.refresh();
		}
	});
</script>

{#if isPublicPage}
	{@render children()}
{:else if booting}
	<LoadingScreen message="Connecting to AiVM…" />
{:else}
	<div class="flex h-screen overflow-hidden">
		<!-- Mobile header -->
		<header
			class="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 py-3 bg-[var(--color-surface-2)] border-b border-[var(--color-border-subtle)]"
		>
			<button
				type="button"
				onclick={toggleSidebar}
				class="p-2 -ml-2 rounded-lg text-gray-400 hover:bg-white/5 hover:text-gray-100 transition-colors"
				aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={sidebarOpen}
			>
				<svg
					class="w-5 h-5"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					{#if sidebarOpen}
						<path d="M6 18L18 6M6 6l12 12" />
					{:else}
						<path d="M4 6h16M4 12h16M4 18h16" />
					{/if}
				</svg>
			</button>

			<div class="flex items-center gap-2">
				<svg
					class="w-5 h-5 text-cyan-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
				</svg>
				<span class="font-bold text-white text-sm tracking-tight"
					>Ai<span class="text-cyan-400">VM</span></span
				>
			</div>

			<div class="ml-auto flex items-center">
				<HealthIndicator
					level={backendHealth.level}
					summary={backendHealth.summary}
					backends={backendHealth.backends}
				/>
			</div>
		</header>

		<!-- Mobile backdrop -->
		{#if sidebarOpen}
			<button
				type="button"
				class="md:hidden fixed inset-0 z-40 bg-black/50"
				onclick={closeSidebar}
				aria-label="Close menu"
			></button>
		{/if}

		<!-- Sidebar -->
		<aside
			class={`app-sidebar fixed md:relative inset-y-0 left-0 z-50 flex w-52 flex-shrink-0 flex-col bg-[var(--color-surface-2)] border-r border-[var(--color-border-subtle)] transition-transform duration-200 ease-in-out ${sidebarOpen ? 'is-open' : ''}`}
		>
			<!-- Logo (desktop) -->
			<div
				class="hidden md:flex items-center gap-2.5 px-4 py-4 border-b border-[var(--color-border-subtle)]"
			>
				<svg
					class="w-6 h-6 text-cyan-400 shrink-0"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
				</svg>
				<span class="text-sm font-bold text-white tracking-tight"
					>Ai<span class="text-cyan-400">VM</span></span
				>
				<div class="ml-auto flex items-center shrink-0">
					<HealthIndicator
						level={backendHealth.level}
						summary={backendHealth.summary}
						backends={backendHealth.backends}
						align="left"
					/>
				</div>
			</div>

			<!-- Mobile sidebar header -->
			<div
				class="md:hidden flex items-center justify-between px-4 py-4 border-b border-[var(--color-border-subtle)]"
			>
				<div class="flex items-center gap-2">
					<svg
						class="w-5 h-5 text-cyan-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
					</svg>
					<span class="text-sm font-bold text-white tracking-tight">Menu</span>
				</div>
				<button
					type="button"
					onclick={closeSidebar}
					class="p-2 rounded-lg text-gray-400 hover:bg-white/5 hover:text-gray-100 transition-colors"
					aria-label="Close menu"
				>
					<svg
						class="w-5 h-5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Navigation -->
			<nav class="flex-1 overflow-y-auto py-3 px-2">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						target={item.external ? '_blank' : undefined}
						rel={item.external ? 'noopener noreferrer' : undefined}
						onclick={closeSidebar}
						class={`flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5 text-sm font-medium transition-all duration-150 border ${isActive(item.href) ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20' : 'text-gray-400 border-transparent hover:text-gray-200 hover:bg-white/5'}`}
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
							{#each item.paths as d, i (i)}
								<path {d} />
							{/each}
						</svg>
						{item.label}
					</a>
				{/each}
			</nav>

			<!-- Footer -->
			<div class="border-t border-[var(--color-border-subtle)] p-3">
				{#if auth.user}
					<div class="flex items-center gap-2 px-2 py-1.5 mb-1">
						<div
							class="w-7 h-7 rounded-full bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-xs font-bold text-cyan-400 shrink-0"
						>
							{auth.user.username.charAt(0).toUpperCase()}
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium text-gray-200 truncate">{auth.user.username}</p>
							<p class="text-xs text-[var(--color-text-subtle)] truncate">{auth.user.role}</p>
						</div>
					</div>
				{/if}
				<button
					onclick={handleLogout}
					class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-white/5 hover:text-gray-200 transition-colors"
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
							d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"
						/>
					</svg>
					Sign out
				</button>
			</div>
		</aside>

		<!-- Main content -->
		<main class="flex-1 min-w-0 overflow-y-auto bg-[var(--color-surface)] pt-14 md:pt-0">
			{@render children()}
		</main>
	</div>
{/if}

import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const PROXY_TARGET = process.env.AIVM_PROXY_URL ?? 'http://localhost:4001';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
		server: {
			proxy: {
				// Same-origin dev: browser → :5173/api → proxy :4001/api (cookies work)
			'/api': {
				target: PROXY_TARGET,
				changeOrigin: true
			},
			// Operational endpoints live on the proxy, not the SvelteKit UI
			'/metrics': {
				target: PROXY_TARGET,
				changeOrigin: true
			},
			'/health': {
				target: PROXY_TARGET,
				changeOrigin: true
			},
			'/ready': {
				target: PROXY_TARGET,
				changeOrigin: true
			},
			'/docs': {
				target: PROXY_TARGET,
				changeOrigin: true
			}
		}
	}
});

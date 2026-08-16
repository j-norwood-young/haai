import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const PROXY_TARGET = process.env.HAAI_PROXY_URL ?? 'http://localhost:4001';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			// Same-origin dev: browser → Vite /api → proxy :4001 (cookies work)
			'/api': {
				target: PROXY_TARGET,
				changeOrigin: true,
				// Keep SSE streams open (no response buffering)
				configure: (proxy) => {
					proxy.on('proxyRes', (proxyRes) => {
						const contentType = proxyRes.headers['content-type'];
						if (typeof contentType === 'string' && contentType.includes('text/event-stream')) {
							proxyRes.headers['cache-control'] = 'no-cache, no-transform';
							proxyRes.headers['x-accel-buffering'] = 'no';
						}
					});
				}
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

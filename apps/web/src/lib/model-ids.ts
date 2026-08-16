import type { Backend } from './api.js';

/** Strip `:<host>:<provider>` from a namespaced model ID to get the upstream model ID. */
export function rawBackendModelId(namespacedId: string, backend?: Pick<Backend, 'host' | 'provider'>): string {
	if (backend?.host && backend?.provider) {
		const suffix = `:${backend.host}:${backend.provider}`;
		if (namespacedId.endsWith(suffix)) {
			return namespacedId.slice(0, -suffix.length);
		}
	}
	const parts = namespacedId.split(':');
	if (parts.length >= 3) {
		return parts.slice(0, -2).join(':');
	}
	return namespacedId;
}

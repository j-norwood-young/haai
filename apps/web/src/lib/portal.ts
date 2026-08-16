import type { Action } from 'svelte/action';

/** Move a node to `document.body` so `position: fixed` is viewport-relative. */
export const portal: Action<HTMLElement> = (node) => {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
};

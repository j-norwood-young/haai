export function formatNum(n: number): string {
	if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(Math.round(n));
}

export function formatPct(ratio: number, digits = 2): string {
	return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatMs(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDuration(ms: number): string {
	if (ms < 0) ms = 0;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.floor((ms % 60_000) / 1000);
	return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatRate(n: number, unit: string): string {
	return `${formatNum(n)} ${unit}`;
}

export function relativeTime(ts: number | string): string {
	const t = typeof ts === 'string' ? Date.parse(ts) : ts;
	if (!Number.isFinite(t)) return '—';
	const delta = Math.max(0, Date.now() - t);
	if (delta < 1000) return 'just now';
	if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return `${Math.floor(delta / 86_400_000)}d ago`;
}

/** Percentage change from previous to current; null when not computable. */
export function deltaPct(current: number, previous: number | undefined | null): number | null {
	if (previous == null || previous === 0) return null;
	return (current - previous) / previous;
}

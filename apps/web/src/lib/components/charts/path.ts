export interface LineDomain {
	min: number;
	max: number;
}

export function computeDomain(values: number[], baselineZero = true): LineDomain {
	let min = Infinity;
	let max = -Infinity;
	for (const v of values) {
		if (v < min) min = v;
		if (v > max) max = v;
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
	if (baselineZero) min = Math.min(0, min);
	if (min === max) {
		max = min + 1;
		if (!baselineZero) min = min - 1;
	}
	return { min, max };
}

/** Map a value to an SVG y coordinate (inverted, padded). */
export function scaleY(value: number, domain: LineDomain, h: number, pad = 2): number {
	const span = domain.max - domain.min || 1;
	const t = (value - domain.min) / span;
	return pad + (1 - t) * (h - pad * 2);
}

export function scaleX(index: number, count: number, w: number): number {
	if (count <= 1) return w / 2;
	return (index / (count - 1)) * w;
}

/**
 * Build an SVG polyline path for `values` across a `w`×`h` box.
 * With fewer than 2 points a flat line is drawn.
 */
export function buildLinePath(
	values: number[],
	w: number,
	h: number,
	domain?: LineDomain,
	pad = 2
): string {
	if (values.length === 0) return '';
	const d = domain ?? computeDomain(values);
	if (values.length < 2) {
		const y = scaleY(values[0] ?? 0, d, h, pad);
		return `M 0 ${y} L ${w} ${y}`;
	}
	let path = '';
	for (let i = 0; i < values.length; i++) {
		const x = scaleX(i, values.length, w);
		const y = scaleY(values[i] ?? 0, d, h, pad);
		path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
	}
	return path;
}

/** Build a closed area path (line down to the bottom edge). */
export function buildAreaPath(
	values: number[],
	w: number,
	h: number,
	domain?: LineDomain,
	pad = 2
): string {
	if (values.length === 0) return '';
	const line = buildLinePath(values, w, h, domain, pad);
	if (values.length < 2) return '';
	return `${line} L ${w} ${h} L 0 ${h} Z`;
}

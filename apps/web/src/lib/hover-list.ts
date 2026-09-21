export interface HoverListItem {
	label: string;
	/** Secondary text shown after the label (e.g. a backend model ID). */
	detail?: string;
	/** Dims the row and shows `note` beside it. */
	inactive?: boolean;
	note?: string;
}

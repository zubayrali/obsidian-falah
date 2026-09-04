import { juzOf, pageOf } from "./locate";
import type { QuranNav } from "./schema";

export interface QuranPosition {
	juz: number;
	page: number;
}

export interface PositionLabels {
	juz: (n: number) => string;
	page: (n: number) => string;
	separator: string;
}

export const DEFAULT_POSITION_LABELS: PositionLabels = {
	juz: (n) => `Juz ${n}`,
	page: (n) => `Page ${n}`,
	separator: " · ",
};

/** Return the containing juz and Madani mushaf page for an ayah. */
export function currentPosition(nav: QuranNav, surah: number, ayah: number): QuranPosition | undefined {
	const juz = juzOf(nav, surah, ayah);
	const page = pageOf(nav, surah, ayah);
	if (!juz || !page) return undefined;
	return { juz: juz.n, page: page.n };
}

export function formatPosition(
	position: QuranPosition,
	labels: PositionLabels = DEFAULT_POSITION_LABELS,
): string {
	return `${labels.juz(position.juz)}${labels.separator}${labels.page(position.page)}`;
}

/** Convenience helper for the reader's current-position display. */
export function describeCurrentPosition(
	nav: QuranNav,
	surah: number,
	ayah: number,
	labels: PositionLabels = DEFAULT_POSITION_LABELS,
): string | undefined {
	const position = currentPosition(nav, surah, ayah);
	return position ? formatPosition(position, labels) : undefined;
}

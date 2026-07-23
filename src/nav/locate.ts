// Pure reverse lookup: which juz/page/hizb/rub contains a surah:ayah.
// Binary search over position-sorted NavPoint arrays. No "obsidian" import.
import type { NavPoint, QuranNav } from "./schema";

const cmp = (surah: number, ayah: number, p: NavPoint) =>
	surah !== p.surah ? surah - p.surah : ayah - p.ayah;

/** The last point at or before (surah, ayah); undefined if before the first. */
export function locatePoint(points: NavPoint[], surah: number, ayah: number): NavPoint | undefined {
	let lo = 0, hi = points.length - 1, ans: NavPoint | undefined;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (cmp(surah, ayah, points[mid]) >= 0) { ans = points[mid]; lo = mid + 1; }
		else hi = mid - 1;
	}
	return ans;
}

export const juzOf = (nav: QuranNav, s: number, a: number) => locatePoint(nav.juz, s, a);
export const pageOf = (nav: QuranNav, s: number, a: number) => locatePoint(nav.pages, s, a);
export const hizbOf = (nav: QuranNav, s: number, a: number) => locatePoint(nav.hizb, s, a);
export const rubOf = (nav: QuranNav, s: number, a: number) => locatePoint(nav.rub, s, a);

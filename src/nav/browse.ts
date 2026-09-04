import type { Surah } from "../data/schema";
import type { QuranNav } from "./schema";

export const BROWSE_TABS = ["surahs", "juz", "pages", "sajdah"] as const;

export type BrowseTab = (typeof BROWSE_TABS)[number];

export interface BrowseRow {
	id: string;
	label: string;
	sublabel?: string;
	surah: number;
	ayah: number;
}

/** Copy used by the browse model. A caller can replace every formatter for i18n. */
export interface BrowseLabels {
	tab: Record<BrowseTab, string>;
	surah: (surah: Surah) => string;
	surahDetails: (surah: Surah) => string;
	juz: (n: number) => string;
	page: (n: number) => string;
	sajdah: (n: number) => string;
	location: (surah: Surah | undefined, surahNumber: number, ayah: number) => string;
	sajdahType: (type: "recommended" | "obligatory") => string;
}

export const DEFAULT_BROWSE_LABELS: BrowseLabels = {
	tab: { surahs: "Surahs", juz: "Juz", pages: "Pages", sajdah: "Sajdah" },
	surah: (surah) => `${surah.number}. ${surah.nameTransliterated}`,
	surahDetails: (surah) => `${surah.nameArabic} · ${surah.ayahCount} ayahs`,
	juz: (n) => `Juz ${n}`,
	page: (n) => `Page ${n}`,
	sajdah: (n) => `Sajdah ${n}`,
	location: (surah, surahNumber, ayah) =>
		`${surah?.nameTransliterated ?? `Surah ${surahNumber}`} ${surahNumber}:${ayah}`,
	sajdahType: (type) => type === "obligatory" ? "Obligatory" : "Recommended",
};

/**
 * Build the rows for one browse tab. This is deliberately independent of the
 * modal so ordering, labels, and destinations can be verified without Obsidian.
 */
export function buildBrowseRows(
	tab: BrowseTab,
	surahs: Surah[],
	nav: QuranNav,
	labels: BrowseLabels = DEFAULT_BROWSE_LABELS,
): BrowseRow[] {
	const byNumber = new Map(surahs.map((surah) => [surah.number, surah]));
	const location = (surah: number, ayah: number) => labels.location(byNumber.get(surah), surah, ayah);

	switch (tab) {
		case "surahs":
			return [...surahs]
				.sort((a, b) => a.number - b.number)
				.map((surah) => ({
					id: `surah-${surah.number}`,
					label: labels.surah(surah),
					sublabel: labels.surahDetails(surah),
					surah: surah.number,
					ayah: 1,
				}));
		case "juz":
			return nav.juz.map((point) => ({
				id: `juz-${point.n}`,
				label: labels.juz(point.n),
				sublabel: location(point.surah, point.ayah),
				surah: point.surah,
				ayah: point.ayah,
			}));
		case "pages":
			return nav.pages.map((point) => ({
				id: `page-${point.n}`,
				label: labels.page(point.n),
				sublabel: location(point.surah, point.ayah),
				surah: point.surah,
				ayah: point.ayah,
			}));
		case "sajdah":
			return nav.sajdahs.map((point, index) => ({
				id: `sajdah-${index + 1}`,
				label: labels.sajdah(index + 1),
				sublabel: `${location(point.surah, point.ayah)} · ${labels.sajdahType(point.type)}`,
				surah: point.surah,
				ayah: point.ayah,
			}));
	}
}

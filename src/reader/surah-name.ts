import type { ResourceDescriptor, Surah } from "../data/schema";

type ChapterNames = Record<string, unknown>;

/** QUL Surah Name Fonts v4 maps these ASCII ligatures to the 114 decorative
 * Arabic chapter-name glyphs. Keeping this conversion pure makes it usable in
 * both Study and Mushaf rendering without duplicating font-specific strings. */
export function surahNameFontLigature(surahNumber: number): string {
	if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) {
		throw new RangeError("Invalid Surah number: " + surahNumber);
	}
	return "surah" + String(surahNumber).padStart(3, "0");
}

/**
 * Resolve the chapter label from the active translation, never from an
 * unrelated default translation. Translation packs may provide localized
 * names through `meta.chapterNames`. The one bundled translation owns the
 * bundled English title table. Other packs must never inherit that table:
 * when they do not provide a title, use the stable English transliteration.
 */
export function readerSurahName(
	surah: Surah,
	translation?: ResourceDescriptor,
): string {
	if (!translation) return surah.nameTransliterated;

	const chapterNames = translation.meta?.chapterNames;
	if (chapterNames && typeof chapterNames === "object" && !Array.isArray(chapterNames)) {
		const translated = (chapterNames as ChapterNames)[String(surah.number)];
		if (typeof translated === "string" && translated.trim()) return translated.trim();
	}

	return translation.tier === "bundled" ? surah.nameEnglish : surah.nameTransliterated;
}

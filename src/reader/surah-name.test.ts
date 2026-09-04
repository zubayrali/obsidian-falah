import { describe, expect, it } from "vitest";
import type { ResourceDescriptor, Surah } from "../data/schema";
import { readerSurahName, surahNameFontLigature } from "./surah-name";

const surah: Surah = {
	number: 2,
	nameArabic: "البقرة",
	nameEnglish: "The Cow",
	nameTransliterated: "Al-Baqarah",
	ayahCount: 286,
	revelationPlace: "madinah",
};

function translation(language: string, meta?: Record<string, unknown>): ResourceDescriptor {
	return {
		id: `translation-${language}`,
		type: "translation",
		name: "Translation",
		language,
		tier: "downloaded",
		meta,
	};
}

describe("readerSurahName", () => {
	it("uses English transliteration when no translation is selected", () => {
		expect(readerSurahName(surah)).toBe("Al-Baqarah");
	});

	it("uses the bundled title for the bundled translation", () => {
		expect(readerSurahName(surah, { ...translation("en"), tier: "bundled" })).toBe("The Cow");
	});

	it("uses a chapter name supplied by the selected translation", () => {
		const french = translation("fr", { chapterNames: { "2": "La Vache" } });
		expect(readerSurahName(surah, french)).toBe("La Vache");
	});

	it("does not show a shared title for a translation that supplies none", () => {
		expect(readerSurahName(surah, translation("en"))).toBe("Al-Baqarah");
		expect(readerSurahName(surah, translation("fr"))).toBe("Al-Baqarah");
	});
});

describe("surahNameFontLigature", () => {
	it("creates the zero-padded ligatures required by QUL Surah Names v4", () => {
		expect(surahNameFontLigature(1)).toBe("surah001");
		expect(surahNameFontLigature(114)).toBe("surah114");
	});

	it("rejects values outside the Quran's Surah range", () => {
		expect(() => surahNameFontLigature(0)).toThrow(RangeError);
		expect(() => surahNameFontLigature(115)).toThrow(RangeError);
	});
});

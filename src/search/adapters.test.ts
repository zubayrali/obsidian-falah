import { describe, expect, it } from "vitest";
import {
	documentsFromAyahs,
	documentsFromTafsirs,
	documentsFromTranslations,
	editionFromResource,
} from "./adapters";

const edition = { id: "resource", name: "Resource", type: "translation" as const, language: "en" };

describe("search data adapters", () => {
	it("converts searchable resource descriptors", () => {
		expect(editionFromResource({ ...edition, tier: "bundled" })).toEqual(edition);
		expect(editionFromResource({ ...edition, type: "recitation", tier: "downloaded" })).toBeUndefined();
	});

	it("converts the three canonical Quran record shapes", () => {
		expect(documentsFromAyahs(edition, [{ ayahKey: "1:1", surah: 1, ayah: 1, text: "Arabic" }])).toEqual([
			{ edition, ayahKey: "1:1", text: "Arabic" },
		]);
		expect(documentsFromTranslations(edition, [{ ayahKey: "1:1", text: "Translation" }])).toEqual([
			{ edition, ayahKey: "1:1", text: "Translation" },
		]);
		expect(documentsFromTafsirs(edition, [{ ayahKey: "1:1", ayahKeys: ["1:1", "1:2"], text: "Tafsir" }])).toEqual([
			{ edition, ayahKey: "1:1", ayahKeys: ["1:1", "1:2"], text: "Tafsir" },
		]);
	});
});

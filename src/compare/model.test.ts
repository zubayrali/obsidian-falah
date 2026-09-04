import { describe, expect, it } from "vitest";
import { alignEditions, comparisonLayout, editionAvailableForSurah, normalizeEditionSelection } from "./model";

describe("comparison model", () => {
	it("tracks whether a comparison edition covers the current surah", () => {
		expect(editionAvailableForSurah({ id: "core", type: "translation", name: "Core", language: "en", tier: "bundled" }, 107)).toBe(true);
		expect(editionAvailableForSurah({ id: "partial", type: "translation", name: "Partial", language: "en", tier: "downloaded", installedSurahs: [1, 2, 24] }, 107)).toBe(false);
		expect(editionAvailableForSurah({ id: "complete", type: "translation", name: "Complete", language: "en", tier: "downloaded", installedSurahs: [107] }, 107)).toBe(true);
	});

	it("drops duplicates and unavailable editions", () => {
		const available = [{ id: "a", name: "A", type: "translation" as const }];
		expect(normalizeEditionSelection(["a", "missing", "a"], available)).toEqual(["a"]);
	});
	it("aligns translations and ranged tafsir", () => {
		const rows = alignEditions(["2:1", "2:2"], [
			{ id: "tr", verses: [{ ayahKey: "2:1", text: "one" }] },
			{ id: "tf", verses: [{ ayahKey: "2:1", ayahKeys: ["2:1", "2:2"], text: "both" }] },
		]);
		expect(rows[1].values).toEqual({ tf: "both" });
	});

	it("applies separate translation and tafsir limits while preserving order", () => {
		const available = [
			{ id: "tr-a", name: "A", type: "translation" as const },
			{ id: "tr-b", name: "B", type: "translation" as const },
			{ id: "tf-a", name: "Tafsir", type: "tafsir" as const },
		];
		expect(normalizeEditionSelection(
			["tr-a", "tr-b", "tf-a"],
			available,
			{ max: 3, maxTranslations: 1, maxTafsirs: 1 },
		)).toEqual(["tr-a", "tf-a"]);
	});

	it("keeps overlapping text deterministic without duplicate rows or values", () => {
		const rows = alignEditions(["2:1", "2:1"], [{ id: "tf", verses: [
			{ ayahKey: "2:1", text: " first " },
			{ ayahKey: "2:1", ayahKeys: ["2:1", "2:1"], text: "second" },
			{ ayahKey: "2:1", text: "first" },
		] }]);
		expect(rows).toEqual([{ ayahKey: "2:1", values: { tf: "first\n\nsecond" } }]);
	});

	it("returns responsive layout metadata", () => {
		expect(comparisonLayout(3, 390)).toMatchObject({ mode: "stacked", columnCount: 1 });
		expect(comparisonLayout(3, 800)).toMatchObject({ mode: "columns", overflow: "horizontal" });
		expect(comparisonLayout(2, 800)).toMatchObject({ mode: "columns", overflow: "none" });
	});
});

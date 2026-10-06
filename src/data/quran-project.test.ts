import { describe, expect, it } from "vitest";
import { QuranProjectSource } from "./quran-project";

describe("QuranProjectSource", () => {
	it("offers three languages and keeps the requested verse positions", async () => {
		const source = new QuranProjectSource();
		const catalog = await source.listCatalog("translation");
		expect(catalog.map((d) => d.language)).toEqual(["en", "bn", "ur"]);
		for (const desc of catalog) {
			const rows = await source.fetchSurah(desc, 1, 2, async (url) => {
				expect(url).toBe("https://quranapi.pages.dev/api/1.json");
				return { surahNo: 1, totalAyah: 2, english: ["a", "b"], bengali: ["ক", "খ"], urdu: ["ا", "ب"] };
			});
			expect(rows.map((v) => v.ayahKey)).toEqual(["1:1", "1:2"]);
		}
	});
	it("rejects missing interior verses instead of shifting the remaining text", async () => {
		const source = new QuranProjectSource();
		const [desc] = await source.listCatalog("translation");
		await expect(source.fetchSurah(desc, 1, 3, async () => ({ surahNo: 1, totalAyah: 3, english: ["a", "", "c"] }))).rejects.toThrow("1:2");
	});
});

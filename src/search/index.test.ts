import { describe, expect, it, vi } from "vitest";
import { buildOfflineQuranSearchIndex, normalizeText, OfflineQuranSearchIndex } from "./index";
import type { SearchDocumentInput, SearchEdition } from "./types";

const uthmani: SearchEdition = { id: "core-uthmani", name: "Uthmani", type: "quran-script", language: "ar" };
const clear: SearchEdition = { id: "core-en-clearquran", name: "Clear Quran", type: "translation", language: "en" };
const tafsir: SearchEdition = { id: "tafsir-en", name: "Tafsir", type: "tafsir", language: "en" };

const records: SearchDocumentInput[] = [
	{ edition: uthmani, ayahKey: "1:1", text: "بِسْمِ ٱللَّهِ الرَّحْمَٰنِ الرَّحِيمِ" },
	{ edition: clear, ayahKey: "1:1", text: "In the Name of Allah—the Most Compassionate, Most Merciful." },
	{ edition: clear, ayahKey: "1:2", text: "All praise is for Allah—Lord of all worlds," },
	{ edition: tafsir, ayahKey: "1:1", ayahKeys: ["1:1", "1:2"], text: "Mercy opens the chapter and praise follows it." },
	{ edition: clear, ayahKey: "2:1", text: "Alif-Lãm-Mĩm." },
];

describe("normalizeText", () => {
	it("folds Arabic vocalization, tatweel, and alef variants", () => {
		expect(normalizeText("إِنَّ ٱللَّـهَ").text).toBe(normalizeText("ان الله").text);
	});

	it("folds Latin case, accents, punctuation, and whitespace", () => {
		expect(normalizeText("  LÃM—MĨM ").text).toBe("lam mim");
	});
});

describe("OfflineQuranSearchIndex", () => {
	it("lists unique editions for search-scope controls", () => {
		const index = new OfflineQuranSearchIndex();
		index.add({ edition: clear, ayahKey: "2:1", text: "one" });
		index.add({ edition: clear, ayahKey: "2:2", text: "two" });
		index.add({ edition: uthmani, ayahKey: "2:3", text: "three" });
		expect(index.editions().map((edition) => edition.id)).toEqual([clear.id, uthmani.id]);
	});
	it("finds undiacritized Arabic and returns source highlight offsets", () => {
		const index = new OfflineQuranSearchIndex();
		index.addAll(records);
		const [hit] = index.search("الرحمن الرحيم");
		expect(hit).toMatchObject({ ayahKey: "1:1", edition: uthmani });
		const range = hit.snippet.matches[0];
		expect(hit.snippet.text.slice(range.start, range.end)).toContain("الرَّحْمَٰنِ الرَّحِيمِ");
	});

	it("supports phrase and unordered all-term matching", () => {
		const index = new OfflineQuranSearchIndex();
		index.addAll(records);
		expect(index.search("most merciful")[0].ayahKey).toBe("1:1");
		expect(index.search("worlds praise")[0].ayahKey).toBe("1:2");
	});

	it("supports edition, type, language, and surah scopes", () => {
		const index = new OfflineQuranSearchIndex();
		index.addAll(records);
		expect(index.search("mercy", { scope: { types: ["tafsir"] } })).toHaveLength(1);
		expect(index.search("allah", { scope: { editionIds: [uthmani.id] } })).toEqual([]);
		expect(index.search("alif", { scope: { languages: ["en"], surahs: [2] } })[0].ayahKey).toBe("2:1");
	});

	it("sorts equal results by Quran location then edition and honors limits", () => {
		const index = new OfflineQuranSearchIndex();
		index.addAll([
			{ edition: tafsir, ayahKey: "2:2", text: "shared text" },
			{ edition: clear, ayahKey: "1:2", text: "shared text" },
			{ edition: tafsir, ayahKey: "1:2", text: "shared text" },
		]);
		expect(index.search("shared text", { limit: 2 }).map((hit) => `${hit.ayahKey}/${hit.edition.id}`)).toEqual([
			"1:2/core-en-clearquran",
			"1:2/tafsir-en",
		]);
	});

	it("rejects malformed and empty records without destabilizing ids", () => {
		const index = new OfflineQuranSearchIndex();
		expect(index.add({ edition: clear, ayahKey: "bad", text: "text" })).toBe(false);
		expect(index.add({ edition: clear, ayahKey: "1:1", text: " " })).toBe(false);
		expect(index.add(records[1])).toBe(true);
		expect(index.size).toBe(1);
		expect(index.search("compassionate")[0].ayahKey).toBe("1:1");
	});
});

describe("buildOfflineQuranSearchIndex", () => {
	it("builds in deterministic batches and reports progress", async () => {
		const progress: number[] = [];
		const yieldControl = vi.fn(async () => undefined);
		const index = await buildOfflineQuranSearchIndex(records, {
			batchSize: 2,
			yieldControl,
			onProgress: ({ indexed }) => progress.push(indexed),
		});
		expect(index.size).toBe(records.length);
		expect(progress).toEqual([0, 2, 4, 5]);
		expect(yieldControl).toHaveBeenCalledTimes(2);
	});

	it("honors cancellation before indexing a batch", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(buildOfflineQuranSearchIndex(records, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
	});
});

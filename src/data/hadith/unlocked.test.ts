import { describe, expect, it, vi } from "vitest";
import { FallbackHadithProvider, HadithUnlockedProvider, HadithUnlockedSource, normalizeUnlockedBook } from "./unlocked";
import { NetworkError, SchemaError } from "../schema";

describe("Hadith Unlocked", () => {
	it("normalizes chapter exports with exact suffixes, chains, and grading", () => {
		const collection = normalizeUnlockedBook({ book: { alias: "muslim", title: { en: "Muslim" } }, chapters: [{
			title: { en: "Faith" }, items: [
				{ number: "8a", text: { ar: "المتن", en: "Text A" }, chain: { ar: "السند", en: "Chain" }, grade: { en: "Sound" }, grader: { en: "Muslim" } },
				{ number: "8b", text: { ar: "ب", en: "Text B" } },
			],
		}] }, "muslim", "eng");
		expect(collection.hadiths.map((h) => h.referenceNumber)).toEqual(["8a", "8b"]);
		expect(collection.hadiths[0]).toMatchObject({ arabic: "السند\n\nالمتن", narrator: "Chain", grades: [{ name: "Muslim", grade: "Sound" }], chapter: { english: "Faith" } });
	});
	it("rejects a mismatched offline book instead of installing unrelated content", () => {
		expect(() => normalizeUnlockedBook({ book: { alias: "bukhari" }, chapters: [] }, "muslim", "eng")).toThrow(SchemaError);
	});
	it("walks nested sections and skips introductory headings", () => {
		const c = normalizeUnlockedBook({ book: { alias: "bukhari" }, chapters: [
			{ title: { en: "Introduction" } },
			{ sections: [{ items: [{ number: "59", text: { ar: "عربي", en: "Text" } }] }] },
		] }, "bukhari", "eng");
		expect(c.hadiths[0].referenceNumber).toBe("59");
	});
	it("never substitutes the first live result for the requested narration", async () => {
		const provider = new HadithUnlockedProvider(async () => [{ ref: "muslim:8b", num: "8b", body_en: "Wrong narration" }]);
		await expect(provider.getHadith({ kind: "hadith", collection: "muslim", number: "8a" })).rejects.toThrow("not found");
	});
	it("accepts anthology references only with an explicit exact upstream mapping", async () => {
		const p = new HadithUnlockedProvider(async () => [{ ref: "bukhari:1", num: "1", body_en: "Intentions", virtualReferences: [{ book_alias: "riyad", num: "1" }] }]);
		const content = await p.getHadith({ kind: "hadith", collection: "riyad_assalihin", number: "1" });
		expect(content.externalUrl).toBe("https://hadithunlocked.com/riyad:1");
	});
	it("preserves Malik's compound identifiers rather than assigning a different narration number", () => {
		const c = normalizeUnlockedBook({ book: { alias: "malik" }, chapters: [{ sections: [{ items: [{ number: "1-1", text: { ar: "نص", en: "Prayer" } }] }] }] }, "malik", "eng");
		expect(c.hadiths[0].referenceNumber).toBe("1-1");
		expect(c.hadiths[0].sourceUrl).toBe("https://hadithunlocked.com/malik:1-1");
	});
	it("shares concurrent requests while preserving exact reference and source URL", async () => {
		const fetch = vi.fn(async () => [{ ref: "muslim:8a", num: "8a", body: "نص", body_en: "Text" }]);
		const provider = new HadithUnlockedProvider(fetch);
		const ref = { kind: "hadith" as const, collection: "muslim", number: "8a" };
		const results = await Promise.all([provider.getHadith(ref), provider.getHadith(ref)]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith("https://hadithunlocked.com/muslim:8a?json");
		expect(results[0].externalUrl).toBe("https://hadithunlocked.com/muslim:8a");
	});
	it("uses the verified offline slug and refuses aborted downloads", async () => {
		const controller = new AbortController(); controller.abort();
		const fetch = vi.fn();
		await expect(new HadithUnlockedSource().fetchCollection("riyad_assalihin", "eng", fetch, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
		expect(fetch).not.toHaveBeenCalled();
	});
	it("falls back on missing/network failures, while preserving schema errors", async () => {
		const fallback = { getHadith: vi.fn(async () => ({ ref: { kind: "hadith" as const, collection: "muslim", number: "8a" }, translation: "Exact", externalUrl: "https://hadithunlocked.com/muslim:8a" })), search: async () => [] };
		const primary = { getHadith: vi.fn(async () => { throw new NetworkError("offline"); }), search: async () => [] };
		const provider = new FallbackHadithProvider(primary, fallback);
		expect((await provider.getHadith({ kind: "hadith", collection: "muslim", number: "8a" })).translation).toBe("Exact");
		primary.getHadith.mockRejectedValueOnce(new SchemaError("bad shape"));
		await expect(provider.getHadith({ kind: "hadith", collection: "muslim", number: "8a" })).rejects.toThrow(SchemaError);
		expect(fallback.getHadith).toHaveBeenCalledTimes(1);
	});
});

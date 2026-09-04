import { describe, expect, it, vi } from "vitest";
import { NotInstalledError, type ResourceDescriptor } from "../data/schema";
import type { SurahReading } from "../data/source";
import { loadReaderEnhancements, loadWordRowsForAyahKeys } from "./enhancements";

const reading: SurahReading = {
	surah: {
		number: 107,
		nameArabic: "الماعون",
		nameEnglish: "The Small Kindnesses",
		nameTransliterated: "Al-Ma'un",
		ayahCount: 1,
		revelationPlace: "makkah",
	},
	showBismillah: true,
	ayahs: [{ ayah: 1, ayahKey: "107:1", arabic: "أَرَأَيْتَ" }],
};

const ahmedRaza: ResourceDescriptor = {
	id: "alquran-cloud-en.ahmedraza",
	type: "translation",
	name: "Ahmed Raza Khan",
	language: "en",
	tier: "downloaded",
	installedSurahs: [1, 2, 24],
};

describe("loadReaderEnhancements comparisons", () => {
	it("reports a selected comparison whose current surah is not installed", async () => {
		const result = await loadReaderEnhancements(
			reading,
			[ahmedRaza],
			[ahmedRaza.id],
			undefined,
			{
				quran: {
					getTranslation: vi.fn(async () => { throw new NotInstalledError(ahmedRaza.id); }),
					getTafsir: vi.fn(),
				},
				words: { listResources: vi.fn(async () => []), readVerse: vi.fn() },
			},
		);

		expect(result.comparisonFailures).toEqual([
			{ id: ahmedRaza.id, name: "Ahmed Raza Khan", reason: "not-installed" },
		]);
		expect(result.comparisonRows.get("107:1")?.values).toEqual({});
	});
});

describe("loadWordRowsForAyahKeys", () => {
	it("maps QCF ayah keys to the installed morphology word positions", async () => {
		const readVerse = vi.fn(async (_resourceId: string, ayahKey: string) => ({
			ayahKey,
			words: [{
				position: 1,
				text: "بسم",
				morphology: { location: `${ayahKey}:1`, partOfSpeech: "Noun", segments: [] },
			}],
		}));
		const result = await loadWordRowsForAyahKeys(
			["1:1", "1:1", "1:2"],
			{ resourceId: "words-en", showTranslation: true, showTransliteration: true },
			{
				listResources: vi.fn(async () => [{
					descriptor: {
						id: "words-en",
						type: "translation" as const,
						name: "English words",
						language: "en",
						tier: "downloaded" as const,
						cardinality: "per-word" as const,
					},
					installed: true,
				}]),
				readVerse,
			},
		);

		expect(readVerse).toHaveBeenCalledTimes(2);
		expect(result.rows.get("1:2")?.[0]).toMatchObject({
			key: "1:2:1",
			position: 1,
			morphology: { partOfSpeech: "Noun" },
		});
	});
});

import { describe, expect, it } from "vitest";
import { buckwalterToArabic, normalizeQuranComWords, parseCorpusMorphology } from "./download";

const CORPUS_SAMPLE = [
	"LOCATION\tFORM\tTAG\tFEATURES",
	"(1:1:1:1)\tbi\tP\tPREFIX|bi+",
	"(1:1:1:2)\tsomi\tN\tSTEM|POS:N|LEM:{som|ROOT:smw|M|GEN",
	"(1:5:1:1)\t<iy~aA\tPRON\tSTEM|POS:PRON|LEM:<iy~aA|2MS",
	"(1:5:1:2)\tka\tPRON\tSUFFIX|+n:PRON|2MS",
].join("\n");

describe("word analysis download normalization", () => {
	it("converts Buckwalter and groups corpus segments by word location", () => {
		expect(buckwalterToArabic("r~aHiym")).toBe("رَّحِيم");
		expect(buckwalterToArabic("wA@")).toBe("وا۟");
		const words = parseCorpusMorphology(CORPUS_SAMPLE);
		const first = words.get("1:1:1");
		expect(first).toMatchObject({
			root: "سمو",
			lemma: "ٱسْم",
			partOfSpeech: "Noun",
			case: "Genitive",
			gender: "Masculine",
			number: undefined,
		});
		expect(first?.segments.map((segment) => segment.type)).toEqual(["prefix", "stem"]);
		expect(words.get("1:5:1")).toMatchObject({ person: "Second person", number: "Singular" });
	});

	it("joins Quran.com display words to morphology and contextual meanings", () => {
		const morphology = parseCorpusMorphology(CORPUS_SAMPLE);
		const verses = normalizeQuranComWords({ verses: [{
			verse_key: "1:1",
			words: [
				{
					position: 1,
					char_type_name: "word",
					text_uthmani: "بِسْمِ",
					translation: { text: "In (the) name" },
					transliteration: { text: "bis'mi" },
				},
				{ position: 2, char_type_name: "end", text_uthmani: "١" },
			],
		}] }, morphology);
		expect(verses).toHaveLength(1);
		expect(verses[0].words).toHaveLength(1);
		expect(verses[0].words[0]).toMatchObject({
			text: "بِسْمِ",
			translation: "In (the) name",
			morphology: { location: "1:1:1", root: "سمو" },
			dictionary: { senses: ["In (the) name"] },
		});
	});
});

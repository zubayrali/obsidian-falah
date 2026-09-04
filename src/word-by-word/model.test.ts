import { describe, expect, it } from "vitest";
import { buildWordViewModels, parseWordByWord, wordRange } from "./model";

describe("word-by-word model", () => {
	it("validates and normalizes word rows", () => {
		const rows = parseWordByWord([{ ayahKey: "1:1", words: [{ text: "بسم", translation: "In the name" }, null] }]);
		expect(rows).toEqual([{ ayahKey: "1:1", words: [{ position: 1, text: "بسم", translation: "In the name", transliteration: undefined }] }]);
	});
	it("selects an addressed word range", () => {
		const words = [1, 2, 3].map((position) => ({ position, text: String(position) }));
		expect(wordRange(words, 2, 3).map((w) => w.position)).toEqual([2, 3]);
		expect(wordRange([{ position: 2, text: "2" }, { position: 4, text: "4" }]))
			.toHaveLength(2);
	});

	it("normalizes positions and ignores duplicate or invalid positions", () => {
		const rows = parseWordByWord([{ ayahKey: "1:1", words: [
			{ position: 2, text: " رحيم " },
			{ position: 2, text: "duplicate" },
			{ position: 0, text: "invalid" },
			{ position: 1, text: "بسم" },
		] }]);
		expect(rows[0].words.map(({ position, text }) => ({ position, text }))).toEqual([
			{ position: 1, text: "بسم" },
			{ position: 2, text: "رحيم" },
		]);
	});

	it("builds display models while respecting optional layers", () => {
		const [verse] = parseWordByWord([{ ayahKey: "1:1", words: [{
			text: "بسم",
			translation: " In the name ",
			transliteration: " bismi ",
		}] }]);
		expect(buildWordViewModels(verse, { showTransliteration: false })).toEqual([{
			key: "1:1:1",
			position: 1,
			arabic: "بسم",
			gloss: "In the name",
			transliteration: undefined,
			hasSecondaryText: true,
		}]);
	});
});

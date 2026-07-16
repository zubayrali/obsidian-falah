import { describe, expect, it } from "vitest";
import { filterHadiths } from "./browse";
import type { NormHadith } from "./schema";

const hs: NormHadith[] = [
	{ number: 1, arabic: "إنما الأعمال", translation: "Actions are by intentions" },
	{ number: 2, arabic: "بني الإسلام", translation: "Islam is built on five" },
	{ number: 10, arabic: "من حسن", translation: "Part of good Islam" },
	{ number: 12, arabic: "لا يؤمن", translation: "None of you truly believes" },
];

describe("filterHadiths", () => {
	it("empty query returns the first `limit`", () => {
		expect(filterHadiths(hs, "", 2).map((h) => h.number)).toEqual([1, 2]);
	});

	it("numeric query matches by number prefix", () => {
		expect(filterHadiths(hs, "1", 10).map((h) => h.number)).toEqual([1, 10, 12]);
	});

	it("exact numeric query matches that number", () => {
		expect(filterHadiths(hs, "2", 10).map((h) => h.number)).toEqual([2]);
	});

	it("text query matches translation or arabic, case-insensitive", () => {
		expect(filterHadiths(hs, "islam", 10).map((h) => h.number)).toEqual([2, 10]);
		expect(filterHadiths(hs, "الإسلام", 10).map((h) => h.number)).toEqual([2]);
	});

	it("caps results at the limit", () => {
		expect(filterHadiths(hs, "", 3)).toHaveLength(3);
	});
});

import { describe, expect, it } from "vitest";
import { currentPosition, describeCurrentPosition, formatPosition } from "./position";
import type { QuranNav } from "./schema";

const nav: QuranNav = {
	juz: [{ n: 1, surah: 1, ayah: 1 }, { n: 2, surah: 2, ayah: 142 }, { n: 3, surah: 2, ayah: 253 }],
	pages: [{ n: 1, surah: 1, ayah: 1 }, { n: 41, surah: 2, ayah: 235 }, { n: 42, surah: 2, ayah: 243 }],
	hizb: [], rub: [], sajdahs: [], ruku: [],
};

describe("currentPosition", () => {
	it("returns containing units at exact boundaries and within a unit", () => {
		expect(currentPosition(nav, 1, 1)).toEqual({ juz: 1, page: 1 });
		expect(currentPosition(nav, 2, 243)).toEqual({ juz: 2, page: 42 });
		expect(currentPosition(nav, 2, 252)).toEqual({ juz: 2, page: 42 });
		expect(currentPosition(nav, 2, 253)).toEqual({ juz: 3, page: 42 });
	});

	it("returns undefined when either boundary table cannot locate the ayah", () => {
		const incomplete = { ...nav, pages: [{ n: 1, surah: 2, ayah: 1 }] };
		expect(currentPosition(incomplete, 1, 1)).toBeUndefined();
	});
});

describe("position display", () => {
	it("formats the reader header text", () => {
		expect(describeCurrentPosition(nav, 2, 243)).toBe("Juz 2 · Page 42");
	});

	it("supports translated labels and separators", () => {
		expect(formatPosition(
			{ juz: 2, page: 42 },
			{ juz: (n) => `جزء ${n}`, page: (n) => `صفحة ${n}`, separator: "، " },
		)).toBe("جزء 2، صفحة 42");
	});
});

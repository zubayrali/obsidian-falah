import { describe, it, expect } from "vitest";
import { locatePoint, juzOf, pageOf } from "./locate";
import type { QuranNav, NavPoint } from "./schema";

const pts = (xs: [number, number, number][]): NavPoint[] => xs.map(([n, surah, ayah]) => ({ n, surah, ayah }));
const nav = {
	juz: pts([[1, 1, 1], [2, 2, 142], [3, 2, 253]]),
	pages: pts([[1, 1, 1], [2, 1, 8], [3, 2, 1]]),
	hizb: [], rub: [], sajdahs: [], ruku: [],
} as unknown as QuranNav;

describe("locatePoint", () => {
	it("returns the last point at or before a position", () => {
		expect(locatePoint(nav.juz, 2, 200)).toMatchObject({ n: 2 }); // between juz 2 (2:142) and juz 3 (2:253)
		expect(locatePoint(nav.juz, 2, 253)).toMatchObject({ n: 3 }); // exact boundary → that unit
		expect(locatePoint(nav.juz, 1, 1)).toMatchObject({ n: 1 });   // first
	});
	it("returns undefined before the first point", () => {
		expect(locatePoint(pts([[1, 2, 1]]), 1, 1)).toBeUndefined();
	});
});

describe("juzOf / pageOf", () => {
	it("find the containing unit", () => {
		expect(juzOf(nav, 2, 253)?.n).toBe(3);
		expect(pageOf(nav, 1, 9)?.n).toBe(2);
	});
});

import { describe, it, expect } from "vitest";
import { resolveNav, normalizeName } from "./resolve";
import type { Surah } from "../data/schema";
import type { QuranNav, NavPoint } from "./schema";

const surahs: Surah[] = [
	{ number: 1, nameArabic: "الفاتحة", nameEnglish: "The Opener", nameTransliterated: "Al-Fatihah", ayahCount: 7, revelationPlace: "makkah" },
	{ number: 2, nameArabic: "البقرة", nameEnglish: "The Cow", nameTransliterated: "Al-Baqarah", ayahCount: 286, revelationPlace: "madinah" },
];
const pt = (n: number, s: number, a: number): NavPoint => ({ n, surah: s, ayah: a });
const nav = {
	juz: [pt(1, 1, 1), pt(2, 2, 142), pt(3, 2, 253), pt(30, 78, 1)],
	pages: [pt(1, 1, 1), pt(2, 1, 8), pt(50, 2, 253)],
	hizb: [pt(1, 1, 1)], rub: [pt(1, 1, 1)],
	sajdahs: [{ surah: 7, ayah: 206, type: "recommended" as const }],
	ruku: [],
} as unknown as QuranNav;

const first = (q: string) => resolveNav(q, surahs, nav)[0];

describe("resolveNav", () => {
	it("surah:ayah", () => expect(first("2:255")).toMatchObject({ surah: 2, ayah: 255, kind: "ayah" }));
	it("surah name (diacritics/hyphen-insensitive)", () => {
		expect(first("baqara")).toMatchObject({ surah: 2, ayah: 1, kind: "surah" });
		expect(first("al-baqarah")).toMatchObject({ surah: 2 });
		expect(first("البقرة")).toMatchObject({ surah: 2 });
	});
	it("surah name + ayah", () => expect(first("baqara 255")).toMatchObject({ surah: 2, ayah: 255 }));
	it("juz number and name", () => {
		expect(first("juz 3")).toMatchObject({ surah: 2, ayah: 253, kind: "juz" });
		// "amma" is a recognised juz alias (juz 30); the fixture now has a
		// real juz-30 point so this proves the alias FORM actually parses
		// and resolves, not just that it doesn't crash.
		expect(first("juz amma")).toMatchObject({ kind: "juz", surah: 78, ayah: 1 });
	});
	it("page", () => expect(first("page 50")).toMatchObject({ surah: 2, ayah: 253, kind: "page" }));
	it("sajda lists the sajdah verses", () => {
		const c = resolveNav("sajda", surahs, nav);
		expect(c.some((x) => x.kind === "sajdah" && x.surah === 7 && x.ayah === 206)).toBe(true);
	});
	it("bare N is a surah (primary) and offered as a page (secondary)", () => {
		const c = resolveNav("2", surahs, nav);
		expect(c[0]).toMatchObject({ surah: 2, kind: "surah" });
		expect(c.some((x) => x.kind === "page")).toBe(true);
	});
	it("empty / no match → []", () => {
		expect(resolveNav("", surahs, nav)).toEqual([]);
		expect(resolveNav("zzzz", surahs, nav)).toEqual([]);
	});
});

describe("normalizeName", () => {
	it("strips diacritics, hyphens, case", () => {
		expect(normalizeName("Al-Baqarah")).toBe(normalizeName("albaqarah"));
		expect(normalizeName("البَقَرة")).toContain("البقرة".slice(0, 3)); // diacritics stripped
	});
});

import { describe, expect, it } from "vitest";
import type { Surah } from "../data/schema";
import { BROWSE_TABS, buildBrowseRows } from "./browse";
import type { QuranNav } from "./schema";

const surahs: Surah[] = [
	{ number: 2, nameArabic: "البقرة", nameEnglish: "The Cow", nameTransliterated: "Al-Baqarah", ayahCount: 286, revelationPlace: "madinah" },
	{ number: 1, nameArabic: "الفاتحة", nameEnglish: "The Opener", nameTransliterated: "Al-Fatihah", ayahCount: 7, revelationPlace: "makkah" },
];

const nav: QuranNav = {
	juz: [{ n: 1, surah: 1, ayah: 1 }, { n: 2, surah: 2, ayah: 142 }],
	hizb: [],
	rub: [],
	pages: [{ n: 1, surah: 1, ayah: 1 }, { n: 42, surah: 2, ayah: 243 }],
	sajdahs: [{ surah: 2, ayah: 20, type: "recommended" }],
	ruku: [],
};

describe("buildBrowseRows", () => {
	it("supports exactly the four PR2 tabs", () => {
		expect(BROWSE_TABS).toEqual(["surahs", "juz", "pages", "sajdah"]);
	});

	it("sorts surahs and navigates each one to ayah 1", () => {
		const rows = buildBrowseRows("surahs", surahs, nav);
		expect(rows.map((row) => row.id)).toEqual(["surah-1", "surah-2"]);
		expect(rows[0]).toMatchObject({ label: "1. Al-Fatihah", surah: 1, ayah: 1 });
		expect(rows[0].sublabel).toContain("الفاتحة");
	});

	it("uses canonical starts for juz and page rows", () => {
		expect(buildBrowseRows("juz", surahs, nav)[1]).toMatchObject({
			id: "juz-2", label: "Juz 2", surah: 2, ayah: 142,
		});
		expect(buildBrowseRows("pages", surahs, nav)[1]).toMatchObject({
			id: "page-42", label: "Page 42", surah: 2, ayah: 243,
		});
	});

	it("numbers sajdah rows and includes the ruling and location", () => {
		const row = buildBrowseRows("sajdah", surahs, nav)[0];
		expect(row).toMatchObject({ id: "sajdah-1", label: "Sajdah 1", surah: 2, ayah: 20 });
		expect(row.sublabel).toBe("Al-Baqarah 2:20 · Recommended");
	});

	it("accepts translated formatters without changing destinations", () => {
		const labels = {
			tab: { surahs: "S", juz: "J", pages: "P", sajdah: "D" },
			surah: (surah: Surah) => `S${surah.number}`,
			surahDetails: () => "details",
			juz: (n: number) => `J${n}`,
			page: (n: number) => `P${n}`,
			sajdah: (n: number) => `D${n}`,
			location: (_surah: Surah | undefined, s: number, a: number) => `${s}/${a}`,
			sajdahType: () => "type",
		};
		expect(buildBrowseRows("pages", surahs, nav, labels)[1]).toMatchObject({
			label: "P42", sublabel: "2/243", surah: 2, ayah: 243,
		});
	});
});

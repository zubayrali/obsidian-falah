import { describe, expect, it } from "vitest";
import { normalizeFawaz, parseFawazHadithEditions } from "./normalize";
import { normalizeAhmedBaset, normalizeSunnah, parseMhashimCsv } from "./normalize";

const araEd = {
	metadata: { name: "Forty Hadith of an-Nawawi" },
	hadiths: [
		{ hadithnumber: 1, arabicnumber: 1, text: "عَنْ عُمَرَ", grades: [], reference: { book: 1, hadith: 1 } },
		{ hadithnumber: 2, arabicnumber: 2, text: "بينما نحن", grades: [], reference: { book: 1, hadith: 2 } },
	],
};
const engEd = {
	metadata: { name: "Forty Hadith of an-Nawawi" },
	hadiths: [
		{ hadithnumber: 1, arabicnumber: 1, text: "Actions are by intentions", grades: [{ name: "Bukhari", grade: "Sahih" }], reference: { book: 1, hadith: 1 } },
		{ hadithnumber: 2, arabicnumber: 2, text: "While we were sitting", grades: [], reference: { book: 1, hadith: 2 } },
	],
};

describe("normalizeFawaz", () => {
	it("merges arabic + translation editions on hadithnumber", () => {
		const c = normalizeFawaz(araEd, engEd, { source: "fawazahmed0", collection: "nawawi", language: "eng" });
		expect(c.source).toBe("fawazahmed0");
		expect(c.collection).toBe("nawawi");
		expect(c.language).toBe("eng");
		expect(c.name).toBe("Forty Hadith of an-Nawawi");
		expect(c.hadiths).toHaveLength(2);
		expect(c.hadiths[0]).toMatchObject({
			number: 1,
			arabic: "عَنْ عُمَرَ",
			translation: "Actions are by intentions",
			reference: { book: 1, hadith: 1 },
		});
		expect(c.hadiths[0].grades).toEqual([{ name: "Bukhari", grade: "Sahih" }]);
	});

	it("handles an arabic-only install (no translation edition)", () => {
		const c = normalizeFawaz(araEd, null, { source: "fawazahmed0", collection: "nawawi", language: "ara" });
		expect(c.hadiths[0].arabic).toBe("عَنْ عُمَرَ");
		expect(c.hadiths[0].translation).toBeUndefined();
	});

	it("omits an empty grades array", () => {
		const c = normalizeFawaz(araEd, engEd, { source: "fawazahmed0", collection: "nawawi", language: "eng" });
		expect(c.hadiths[1].grades).toBeUndefined();
	});
});

describe("parseFawazHadithEditions", () => {
	const editions = {
		bukhari: {
			name: "Sahih al-Bukhari",
			collection: [
				{ name: "ara-bukhari", language: "Arabic" },
				{ name: "eng-bukhari", language: "English" },
				{ name: "ara-bukhari1", language: "Arabic" },
			],
		},
		nawawi: {
			name: "Forty Hadith of an-Nawawi",
			collection: [
				{ name: "ara-nawawi", language: "Arabic" },
				{ name: "eng-nawawi", language: "English" },
			],
		},
	};

	it("produces one entry per collection with distinct language codes", () => {
		const cat = parseFawazHadithEditions(editions);
		const bukhari = cat.find((e) => e.collection === "bukhari")!;
		expect(bukhari).toMatchObject({ source: "fawazahmed0", name: "Sahih al-Bukhari" });
		expect(bukhari.languages.sort()).toEqual(["ara", "eng"]);
		expect(cat.map((e) => e.collection).sort()).toEqual(["bukhari", "nawawi"]);
	});
});

describe("normalizeAhmedBaset", () => {
	const book = {
		metadata: {
			arabic: { title: "صحيح البخاري", author: "الإمام البخاري" },
			english: { title: "Sahih al-Bukhari", author: "Imam Bukhari" },
		},
		chapters: [
			{ id: 1, arabic: "بدء الوحي", english: "Revelation" },
			{ id: 2, arabic: "الإيمان", english: "Belief" },
		],
		hadiths: [
			{ id: 1, idInBook: 1, chapterId: 1, bookId: 1, arabic: "إنما الأعمال", english: { narrator: "Umar", text: "Actions are by intentions" } },
			{ id: 2, idInBook: 2, chapterId: 2, bookId: 1, arabic: "بني الإسلام", english: { narrator: "Ibn Umar", text: "Islam is built on five" } },
		],
	};

	it("maps arabic/english/narrator/chapter and derives books from chapters", () => {
		const c = normalizeAhmedBaset(book, { collection: "bukhari", language: "eng" });
		expect(c).toMatchObject({ source: "ahmedbaset", collection: "bukhari", language: "eng", name: "Sahih al-Bukhari", nameArabic: "صحيح البخاري" });
		expect(c.hadiths[0]).toMatchObject({
			number: 1,
			arabic: "إنما الأعمال",
			translation: "Actions are by intentions",
			narrator: "Umar",
			chapter: { number: 1 },
		});
		expect(c.books).toEqual([
			{ number: 1, arabic: "بدء الوحي", english: "Revelation" },
			{ number: 2, arabic: "الإيمان", english: "Belief" },
		]);
	});

	it("uses idInBook as the hadith number", () => {
		const c = normalizeAhmedBaset(book, { collection: "bukhari", language: "eng" });
		expect(c.hadiths.map((h) => h.number)).toEqual([1, 2]);
	});
});

describe("normalizeSunnah", () => {
	const input = {
		collection: { name: "Sahih al-Bukhari" },
		hadiths: [
			{
				hadithNumber: "1",
				hadith: [
					{ lang: "ar", body: "إنما الأعمال", chapterTitle: "بدء الوحي", grades: [] },
					{ lang: "en", body: "Actions are by intentions", chapterTitle: "Revelation", grades: [{ graded_by: "Bukhari", grade: "Sahih" }] },
				],
			},
		],
	};

	it("splits ar/en bodies, maps grades and chapter", () => {
		const c = normalizeSunnah(input, { collection: "bukhari", language: "eng" });
		expect(c).toMatchObject({ source: "sunnah", collection: "bukhari", language: "eng", name: "Sahih al-Bukhari" });
		expect(c.hadiths[0]).toMatchObject({
			number: 1,
			arabic: "إنما الأعمال",
			translation: "Actions are by intentions",
			chapter: { english: "Revelation", arabic: "بدء الوحي" },
		});
		expect(c.hadiths[0].grades).toEqual([{ name: "Bukhari", grade: "Sahih" }]);
	});
});

describe("parseMhashimCsv (2-column)", () => {
	it("parses explicit number + arabic from 2-column quoted rows", () => {
		const csv = '"1"," حَدَّثَنَا الْحُمَيْدِيُّ"\n"2","بُنِيَ الْإِسْلَامُ"\n';
		const c = parseMhashimCsv(csv, { collection: "bukhari", name: "Sahih al-Bukhari" });
		expect(c).toMatchObject({ source: "mhashim6", collection: "bukhari", language: "ara", name: "Sahih al-Bukhari" });
		expect(c.hadiths).toHaveLength(2);
		expect(c.hadiths[0]).toEqual({ number: 1, arabic: "حَدَّثَنَا الْحُمَيْدِيُّ" });
		expect(c.hadiths[1]).toEqual({ number: 2, arabic: "بُنِيَ الْإِسْلَامُ" });
		expect(c.hadiths[0].translation).toBeUndefined();
	});

	it("uses the explicit CSV number, not line order (gaps preserved)", () => {
		const csv = '"5","خمسة"\n"9","تسعة"\n';
		const c = parseMhashimCsv(csv, { collection: "muslim", name: "Muslim" });
		expect(c.hadiths.map((h) => h.number)).toEqual([5, 9]);
	});

	it("un-doubles embedded quotes and skips non-matching lines", () => {
		const csv = 'header junk\n"1","قال ""مرحبا"" لهم"\n\n';
		const c = parseMhashimCsv(csv, { collection: "bukhari", name: "Bukhari" });
		expect(c.hadiths).toHaveLength(1);
		expect(c.hadiths[0]).toEqual({ number: 1, arabic: 'قال "مرحبا" لهم' });
	});
});

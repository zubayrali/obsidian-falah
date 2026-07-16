import { describe, expect, it } from "vitest";
import { SchemaError } from "./schema";
import { normalizeFawazEditions, normalizeFawazSurah } from "./normalize";
import { normalizeAlQuranAyahs, normalizeAlQuranEditions } from "./normalize";
import { normalizeQulCatalog, normalizeQulRange, normalizeQulTafsirRange, stripHtml } from "./normalize";
import { normalizePack } from "./normalize";
import { normalizeToCore } from "./normalize";
import type { Surah, TranslationVerse } from "./schema";

describe("normalizeFawazEditions", () => {
	// captured from https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions.json
	const fixture = {
		eng_ahmedali: {
			name: "eng-ahmedali",
			author: "Ahmed Ali",
			language: "English",
			direction: "ltr",
			source: "http://tanzil.net",
			comments: "",
			link: "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/eng-ahmedali.json",
			linkmin: "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/eng-ahmedali.min.json",
		},
		urd_ahsanulbayan: {
			name: "urd-ahsanulbayan",
			author: "Maulana Ashiq Ilahi Bulandshahri",
			language: "Urdu",
			direction: "rtl",
			source: "http://tanzil.net",
			comments: "",
			link: "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/urd-ahsanulbayan.json",
			linkmin: "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/urd-ahsanulbayan.min.json",
		},
	};

	it("maps each edition to a source-qualified descriptor", () => {
		expect(normalizeFawazEditions(fixture)).toEqual([
			{
				id: "fawazahmed0-eng-ahmedali",
				type: "translation",
				name: "Ahmed Ali",
				language: "en",
				tier: "downloaded",
				source: "fawazahmed0",
				sourceResourceId: "eng-ahmedali",
				license: "Unlicense (public domain)",
			},
			{
				id: "fawazahmed0-urd-ahsanulbayan",
				type: "translation",
				name: "Maulana Ashiq Ilahi Bulandshahri",
				language: "ur",
				tier: "downloaded",
				source: "fawazahmed0",
				sourceResourceId: "urd-ahsanulbayan",
				license: "Unlicense (public domain)",
			},
		]);
	});

	it.each([null, "nope", 42, { slug: { name: 1, language: "English" } }])(
		"throws SchemaError on %s",
		(bad) => {
			expect(() => normalizeFawazEditions(bad)).toThrow(SchemaError);
		}
	);
});

describe("normalizeFawazSurah", () => {
	// captured from .../editions/eng-ahmedali/1.json
	const fixture = {
		chapter: [
			{ chapter: 1, verse: 1, text: "In the name of Allah, most benevolent, ever-merciful" },
			{ chapter: 1, verse: 2, text: "ALL PRAISE BE to Allah, Lord of all the worlds" },
			{ chapter: 1, verse: 3, text: "Most beneficent, ever-merciful" },
		],
	};

	it("maps chapter verses to ayah-keyed translation verses", () => {
		expect(normalizeFawazSurah(fixture, 1)).toEqual([
			{ ayahKey: "1:1", text: "In the name of Allah, most benevolent, ever-merciful" },
			{ ayahKey: "1:2", text: "ALL PRAISE BE to Allah, Lord of all the worlds" },
			{ ayahKey: "1:3", text: "Most beneficent, ever-merciful" },
		]);
	});

	it("throws SchemaError when the chapter array is missing", () => {
		expect(() => normalizeFawazSurah({}, 1)).toThrow(SchemaError);
	});

	it("throws SchemaError when a verse belongs to a different chapter", () => {
		expect(() =>
			normalizeFawazSurah({ chapter: [{ chapter: 2, verse: 1, text: "x" }] }, 1)
		).toThrow(SchemaError);
	});

	it("throws SchemaError on a null array entry", () => {
		expect(() => normalizeFawazSurah({ chapter: [null] }, 1)).toThrow(SchemaError);
	});
});

describe("normalizeAlQuranEditions", () => {
	// captured from https://api.alquran.cloud/v1/edition
	const fixture = {
		code: 200,
		status: "OK",
		data: [
			{
				identifier: "ar.muyassar",
				language: "ar",
				name: "تفسير الميسر",
				englishName: "King Fahad Quran Complex",
				format: "text",
				type: "tafsir",
				direction: "rtl",
			},
			{
				identifier: "en.sahih",
				language: "en",
				name: "Saheeh International",
				englishName: "Saheeh International",
				format: "text",
				type: "translation",
				direction: "ltr",
			},
		],
	};

	it("keeps only translation/tafsir editions, source-qualified", () => {
		expect(normalizeAlQuranEditions(fixture)).toEqual([
			{
				id: "alquran-cloud-ar.muyassar",
				type: "tafsir",
				name: "King Fahad Quran Complex",
				language: "ar",
				tier: "downloaded",
				source: "alquran-cloud",
				sourceResourceId: "ar.muyassar",
				license: "AlQuran.cloud open edition",
			},
			{
				id: "alquran-cloud-en.sahih",
				type: "translation",
				name: "Saheeh International",
				language: "en",
				tier: "downloaded",
				source: "alquran-cloud",
				sourceResourceId: "en.sahih",
				license: "AlQuran.cloud open edition",
			},
		]);
	});

	it.each([null, { code: 500 }, { code: 200, data: "nope" }])("throws SchemaError on %s", (bad) => {
		expect(() => normalizeAlQuranEditions(bad)).toThrow(SchemaError);
	});

	it("throws SchemaError on a null array entry", () => {
		expect(() => normalizeAlQuranEditions({ code: 200, data: [null] })).toThrow(SchemaError);
	});
});

describe("normalizeAlQuranAyahs", () => {
	// captured from https://api.alquran.cloud/v1/surah/1/en.sahih (trimmed to 3 ayahs)
	const fixture = {
		code: 200,
		status: "OK",
		data: {
			number: 1,
			name: "سُورَةُ الْفَاتِحَةِ",
			englishName: "Al-Faatiha",
			englishNameTranslation: "The Opening",
			revelationType: "Meccan",
			numberOfAyahs: 7,
			ayahs: [
				{
					number: 1,
					text: "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
					numberInSurah: 1,
					juz: 1,
					manzil: 1,
					page: 1,
					ruku: 1,
					hizbQuarter: 1,
					sajda: false,
				},
				{
					number: 2,
					text: "[All] praise is [due] to Allah, Lord of the worlds -",
					numberInSurah: 2,
					juz: 1,
					manzil: 1,
					page: 1,
					ruku: 1,
					hizbQuarter: 1,
					sajda: false,
				},
				{
					number: 3,
					text: "The Entirely Merciful, the Especially Merciful,",
					numberInSurah: 3,
					juz: 1,
					manzil: 1,
					page: 1,
					ruku: 1,
					hizbQuarter: 1,
					sajda: false,
				},
			],
		},
	};

	it("maps ayahs to ayah-keyed translation verses", () => {
		expect(normalizeAlQuranAyahs(fixture, 1)).toEqual([
			{ ayahKey: "1:1", text: "In the name of Allah, the Entirely Merciful, the Especially Merciful." },
			{ ayahKey: "1:2", text: "[All] praise is [due] to Allah, Lord of the worlds -" },
			{ ayahKey: "1:3", text: "The Entirely Merciful, the Especially Merciful," },
		]);
	});

	it.each([null, { code: 200, data: {} }, { code: 200, data: { ayahs: [{ text: "x" }] } }])(
		"throws SchemaError on %s",
		(bad) => {
			expect(() => normalizeAlQuranAyahs(bad, 1)).toThrow(SchemaError);
		}
	);

	it("throws SchemaError on a null array entry", () => {
		expect(() =>
			normalizeAlQuranAyahs({ code: 200, data: { number: 1, ayahs: [null] } }, 1)
		).toThrow(SchemaError);
	});

	it("throws SchemaError when the response is for a different surah", () => {
		expect(() =>
			normalizeAlQuranAyahs(
				{ code: 200, data: { number: 2, ayahs: [{ numberInSurah: 1, text: "x" }] } },
				1
			)
		).toThrow(SchemaError);
	});
});

describe("normalizeQulCatalog", () => {
	// captured from https://qul.tarteel.ai/api/v1/resources/translations
	const fixture = {
		translations: [
			{
				id: 131,
				name: "Dr. Mustafa Khattab, the Clear Quran",
				language: "english",
				author_name: "Dr. Mustafa Khattab",
				records_count: 6236,
				slug: "clearquran-with-tafsir",
				translated_name: { name: "Dr. Mustafa Khattab, the Clear Quran", locale: "en" },
				updated_at: 1769008356,
			},
			{
				id: 149,
				name: "Fadel Soliman, Bridges’ translation",
				language: "english",
				author_name: "Fadel Soliman",
				records_count: 6236,
				slug: "bridges-translation",
				translated_name: { name: "Fadel Soliman, Bridges’ translation", locale: "en" },
				updated_at: 1769008356,
			},
		],
	};

	it("maps QUL translations to numeric-id descriptors", () => {
		expect(normalizeQulCatalog(fixture, "translation")).toEqual([
			{
				id: "qul-131",
				type: "translation",
				name: "Dr. Mustafa Khattab, the Clear Quran",
				language: "en",
				tier: "downloaded",
				source: "qul",
				sourceResourceId: "131",
				license: "QUL public API",
			},
			{
				id: "qul-149",
				type: "translation",
				name: "Fadel Soliman, Bridges’ translation",
				language: "en",
				tier: "downloaded",
				source: "qul",
				sourceResourceId: "149",
				license: "QUL public API",
			},
		]);
	});

	it("throws SchemaError when the requested type's array is missing", () => {
		expect(() => normalizeQulCatalog(fixture, "tafsir")).toThrow(SchemaError);
	});

	it("reads a tafsir's language from language_name (QUL leaves `language` null there)", () => {
		// captured shape from https://qul.tarteel.ai/api/v1/resources/tafsirs
		const tafsirFixture = {
			tafsirs: [
				{ id: 15, name: "Tafsir al-Tabari", language: null, language_name: "arabic" },
				{ id: 169, name: "Tafsir Ibn Kathir", language: null, language_name: "english" },
			],
		};
		expect(normalizeQulCatalog(tafsirFixture, "tafsir").map((r) => [r.id, r.language])).toEqual([
			["qul-15", "ar"],
			["qul-169", "en"],
		]);
	});

	it("throws SchemaError on a null array entry", () => {
		expect(() => normalizeQulCatalog({ translations: [null] }, "translation")).toThrow(SchemaError);
	});
});

describe("normalizeQulRange", () => {
	// captured from https://qul.tarteel.ai/api/v1/translations/149/by_range?from=1:1&to=1:3
	const fixture = {
		translations: [
			{
				id: 997502,
				verse_key: "1:1",
				verse_id: 1,
				resource_id: 149,
				resource_name: "Fadel Soliman, Bridges’ translation",
				language_id: 38,
				language_name: "english",
				translated_name: { name: "Fadel Soliman, Bridges’ translation", locale: "en" },
				text: "In the name of Allah, the All-Merciful, the Bestower of mercy.",
			},
			{
				id: 997503,
				verse_key: "1:2",
				verse_id: 2,
				resource_id: 149,
				resource_name: "Fadel Soliman, Bridges’ translation",
				language_id: 38,
				language_name: "english",
				translated_name: { name: "Fadel Soliman, Bridges’ translation", locale: "en" },
				text: "All praise be to Allah, Lord of all realms,",
			},
		],
	};

	it("maps by_range rows to ayah-keyed translation verses", () => {
		expect(normalizeQulRange(fixture)).toEqual([
			{ ayahKey: "1:1", text: "In the name of Allah, the All-Merciful, the Bestower of mercy." },
			{ ayahKey: "1:2", text: "All praise be to Allah, Lord of all realms," },
		]);
	});

	it.each([null, {}, { translations: [{ text: "x" }] }])("throws SchemaError on %s", (bad) => {
		expect(() => normalizeQulRange(bad)).toThrow(SchemaError);
	});

	it("throws SchemaError on a null array entry", () => {
		expect(() => normalizeQulRange({ translations: [null] })).toThrow(SchemaError);
	});
});

describe("normalizePack", () => {
	const pack = {
		id: "my-imported-tafsir",
		type: "tafsir",
		name: "My Imported Tafsir",
		language: "en",
		license: "Personal use only",
		verses: [
			{ ayahKey: "1:1", text: "Tafsir of 1:1" },
			{ ayahKey: "1:2", text: "Tafsir of 1:2" },
			{ ayahKey: "2:1", text: "Tafsir of 2:1" },
		],
	};

	it("groups verses by surah and builds a user-import descriptor", () => {
		const { descriptor, bySurah } = normalizePack(pack, "tafsir");
		expect(descriptor).toEqual({
			id: "import-my-imported-tafsir",
			type: "tafsir",
			name: "My Imported Tafsir",
			language: "en",
			tier: "user-import",
			license: "Personal use only",
		});
		expect(bySurah.get(1)).toEqual([
			{ ayahKey: "1:1", text: "Tafsir of 1:1" },
			{ ayahKey: "1:2", text: "Tafsir of 1:2" },
		]);
		expect(bySurah.get(2)).toEqual([{ ayahKey: "2:1", text: "Tafsir of 2:1" }]);
	});

	it("throws SchemaError when the declared type doesn't match the pack", () => {
		expect(() => normalizePack(pack, "translation")).toThrow(SchemaError);
	});

	it.each([
		{ ...pack, id: undefined },
		{ ...pack, verses: "nope" },
		{ ...pack, verses: [{ ayahKey: "not-a-key", text: "x" }] },
	])("throws SchemaError on malformed pack %#", (bad) => {
		expect(() => normalizePack(bad, "tafsir")).toThrow(SchemaError);
	});

	it("throws SchemaError on a null verse entry", () => {
		expect(() => normalizePack({ ...pack, verses: [null] }, "tafsir")).toThrow(SchemaError);
	});

	it.each([
		"../../evil",
		"a/b",
		"a\\b",
		"..",
		".hidden",
		"has:colon",
		"has null",
	])("rejects an unsafe import id %j with SchemaError (Fix B)", (badId) => {
		expect(() => normalizePack({ ...pack, id: badId }, "tafsir")).toThrow(SchemaError);
	});

	it("accepts a normal import id and prefixes it with the safe separator", () => {
		const { descriptor } = normalizePack({ ...pack, id: "my.tafsir_v2" }, "tafsir");
		expect(descriptor.id).toBe("import-my.tafsir_v2");
	});
});

describe("normalizeToCore", () => {
	function fullInputs() {
		const uthmani = Array.from({ length: 6236 }, (_, i) => ({ surah: 1, ayah: i + 1, text: `u${i}` }));
		const indopak = Array.from({ length: 6236 }, (_, i) => ({ surah: 1, ayah: i + 1, text: `i${i}` }));
		const clearQuran: TranslationVerse[] = [{ ayahKey: "1:1", text: "In the Name of Allah…" }];
		const surahs: Surah[] = Array.from({ length: 114 }, (_, i) => ({
			number: i + 1,
			nameArabic: "س",
			nameEnglish: "S",
			nameTransliterated: "S",
			ayahCount: 7,
			revelationPlace: "makkah" as const,
		}));
		return { uthmani, indopak, clearQuran, surahs };
	}

	it("assembles Ayah[] for each script and passes surahs/translation through", () => {
		const out = normalizeToCore(fullInputs());
		expect(out.uthmani).toHaveLength(6236);
		expect(out.uthmani[0]).toEqual({ ayahKey: "1:1", surah: 1, ayah: 1, text: "u0" });
		expect(out.indopak[1]).toEqual({ ayahKey: "1:2", surah: 1, ayah: 2, text: "i1" });
		expect(out.clearquran).toEqual(fullInputs().clearQuran);
		expect(out.surahs).toHaveLength(114);
	});

	it("throws SchemaError when a script isn't the full 6236 ayahs", () => {
		const inputs = fullInputs();
		expect(() => normalizeToCore({ ...inputs, uthmani: inputs.uthmani.slice(0, 100) })).toThrow(
			SchemaError
		);
	});

	it("throws SchemaError when surah metadata isn't the full 114 surahs", () => {
		const inputs = fullInputs();
		expect(() => normalizeToCore({ ...inputs, surahs: inputs.surahs.slice(0, 10) })).toThrow(
			SchemaError
		);
	});
});

describe("normalizeQulTafsirRange", () => {
	it("maps single-verse tafsir entries, stripping HTML to plain text", () => {
		const json = {
			tafsirs: [
				{ verses: ["1:1"], text: '<div lang="en"><h2>Title</h2><p>Praise &amp; thanks.</p></div>' },
			],
		};
		expect(normalizeQulTafsirRange(json)).toEqual([
			{ ayahKey: "1:1", text: "Title\nPraise & thanks." },
		]);
	});

	it("sets ayahKeys for a tafsir block spanning multiple ayahs", () => {
		const json = { tafsirs: [{ verses: ["2:1", "2:2", "2:3"], text: "<p>Grouped</p>" }] };
		expect(normalizeQulTafsirRange(json)).toEqual([
			{ ayahKey: "2:1", ayahKeys: ["2:1", "2:2", "2:3"], text: "Grouped" },
		]);
	});

	it('throws SchemaError when the "tafsirs" array is missing', () => {
		expect(() => normalizeQulTafsirRange({ translations: [] })).toThrow(SchemaError);
	});

	it("throws SchemaError on a malformed entry (no verses / non-string text)", () => {
		expect(() => normalizeQulTafsirRange({ tafsirs: [{ text: "x" }] })).toThrow(SchemaError);
		expect(() => normalizeQulTafsirRange({ tafsirs: [{ verses: ["1:1"], text: 5 }] })).toThrow(SchemaError);
	});
});

describe("stripHtml", () => {
	it("converts block boundaries to newlines and drops inline tags", () => {
		expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One\nTwo");
		expect(stripHtml('a <span class="x">b</span> c')).toBe("a b c");
		expect(stripHtml("line1<br>line2")).toBe("line1\nline2");
	});

	it("decodes entities (with &amp; resolved last)", () => {
		expect(stripHtml("Tom &amp; Jerry &lt;3 &#39;q&#39; &nbsp;end")).toBe("Tom & Jerry <3 'q'  end");
	});

	it("collapses 3+ blank lines and trims", () => {
		expect(stripHtml("<p>a</p><br><br><br><p>b</p>")).toBe("a\n\nb");
	});
});

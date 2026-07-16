import { describe, expect, it } from "vitest";
import {
	findReferences,
	parseAyahKey,
	parseRefUri,
	parseShorthand,
	toAyahKey,
	toAyahKeys,
	toCallout,
	toLabel,
	toMarkdownLink,
	toUri,
} from "./ref";

describe("parseRefUri", () => {
	it("parses a single verse", () => {
		expect(parseRefUri("falah://quran/2/255")).toEqual({ kind: "quran", surah: 2, ayah: 255 });
	});

	it("parses a range", () => {
		expect(parseRefUri("falah://quran/2/255-257")).toEqual({
			kind: "quran",
			surah: 2,
			ayah: 255,
			toAyah: 257,
		});
	});

	it("parses word bounds", () => {
		expect(parseRefUri("falah://quran/2/255?fromWord=1&toWord=12")).toEqual({
			kind: "quran",
			surah: 2,
			ayah: 255,
			fromWord: 1,
			toWord: 12,
		});
	});

	it("parses hadith references", () => {
		expect(parseRefUri("falah://hadith/bukhari/99")).toEqual({
			kind: "hadith",
			collection: "bukhari",
			number: "99",
		});
		expect(parseRefUri("falah://hadith/muslim/8a")).toEqual({
			kind: "hadith",
			collection: "muslim",
			number: "8a",
		});
	});

	it.each([
		"falah://quran/115/1", // surah out of range
		"falah://quran/2/0", // ayah out of range
		"falah://quran/2/255-3", // inverted range
		"falah://quran/2", // missing ayah
		"falah://quran/x/y", // non-numeric
		"falah://quran/2/255?fromWord=5&toWord=2", // inverted words
		"falah://hadith/bukhari", // missing number
		"falah://hadith/bukhari/abc", // non-numeric number
		"qirtaas://quran/2/255", // old scheme, no back-compat (§10)
		"https://quran.com/2/255", // wrong scheme
		"not a uri",
		"",
	])("rejects %s without throwing", (uri) => {
		expect(parseRefUri(uri)).toBeNull();
	});
});

describe("parseShorthand", () => {
	it.each([
		["2:255", { kind: "quran", surah: 2, ayah: 255 }],
		["quran 2:255", { kind: "quran", surah: 2, ayah: 255 }],
		["2:255-257", { kind: "quran", surah: 2, ayah: 255, toAyah: 257 }],
		["bukhari:99", { kind: "hadith", collection: "bukhari", number: "99" }],
		["bukhari 99", { kind: "hadith", collection: "bukhari", number: "99" }],
		["muslim:8a", { kind: "hadith", collection: "muslim", number: "8a" }],
		["Bukhari: 99", { kind: "hadith", collection: "bukhari", number: "99" }],
	])("parses %s", (input, expected) => {
		expect(parseShorthand(input)).toEqual(expected);
	});

	it.each(["quran 99", "hello world", "300:1", "2:255-100", ""])(
		"rejects %s",
		(input) => {
			expect(parseShorthand(input)).toBeNull();
		}
	);
});

describe("formatter", () => {
	it("emits stable canonical URIs", () => {
		expect(toUri({ kind: "quran", surah: 2, ayah: 255 })).toBe("falah://quran/2/255");
		expect(toUri({ kind: "quran", surah: 2, ayah: 255, toAyah: 257 })).toBe(
			"falah://quran/2/255-257"
		);
		expect(toUri({ kind: "hadith", collection: "bukhari", number: "99" })).toBe(
			"falah://hadith/bukhari/99"
		);
	});

	it.each([
		"falah://quran/2/255",
		"falah://quran/2/255-257",
		"falah://quran/2/255?fromWord=1&toWord=12",
		"falah://hadith/bukhari/99",
		"falah://hadith/muslim/8a",
	])("round-trips %s", (uri) => {
		expect(toUri(parseRefUri(uri)!)).toBe(uri);
	});

	it("labels references", () => {
		expect(toLabel({ kind: "quran", surah: 2, ayah: 255 })).toBe("Quran 2:255");
		expect(toLabel({ kind: "hadith", collection: "bukhari", number: "99" })).toBe(
			"Hadith Bukhari 99"
		);
	});

	it("builds markdown links", () => {
		expect(toMarkdownLink({ kind: "quran", surah: 2, ayah: 255 })).toBe(
			"[Quran 2:255](falah://quran/2/255)"
		);
	});

	it("builds callouts with cached text", () => {
		expect(
			toCallout(
				{ kind: "quran", surah: 112, ayah: 1 },
				{ arabic: "قُلْ هُوَ ٱللَّهُ أَحَدٌ", translation: 'Say, "He is Allah, [who is] One,"', attribution: "Surah Al-Ikhlas" }
			)
		).toBe(
			"> [!quran] [Quran 112:1](falah://quran/112/1)\n" +
				"> قُلْ هُوَ ٱللَّهُ أَحَدٌ\n" +
				'> Say, "He is Allah, [who is] One,"\n' +
				"> — Surah Al-Ikhlas"
		);
	});

	it("collapses newlines in cached text", () => {
		expect(
			toCallout({ kind: "hadith", collection: "bukhari", number: "1" }, { translation: "a\nb\n c" })
		).toBe("> [!hadith] [Hadith Bukhari 1](falah://hadith/bukhari/1)\n> a b c");
	});
});

describe("findReferences", () => {
	it("finds references with offsets", () => {
		const text =
			"Before [Quran 2:255](falah://quran/2/255) middle [Hadith Bukhari 99](falah://hadith/bukhari/99) after.";
		const found = findReferences(text);
		expect(found).toHaveLength(2);
		expect(found[0].ref).toEqual({ kind: "quran", surah: 2, ayah: 255 });
		expect(found[0].label).toBe("Quran 2:255");
		expect(text.slice(found[0].index, found[0].index + found[0].match.length)).toBe(
			"[Quran 2:255](falah://quran/2/255)"
		);
		expect(found[1].ref).toEqual({ kind: "hadith", collection: "bukhari", number: "99" });
	});

	it("skips malformed references, other links, and the old scheme", () => {
		const text =
			"[bad](falah://quran/999/1) and [site](https://example.com) and " +
			"[old](qirtaas://quran/2/255) and plain falah://quran/2/255";
		expect(findReferences(text)).toHaveLength(0);
	});
});

describe("underscore collection slugs", () => {
	it("parseShorthand accepts an underscore slug", () => {
		expect(parseShorthand("mishkat_almasabih:1")).toEqual({
			kind: "hadith",
			collection: "mishkat_almasabih",
			number: "1",
		});
	});

	it("parseShorthand still rejects a leading-digit slug", () => {
		expect(parseShorthand("1bukhari:1")).toBeNull();
	});

	it("parseShorthand still parses a plain slug", () => {
		expect(parseShorthand("bukhari:99")).toEqual({ kind: "hadith", collection: "bukhari", number: "99" });
	});

	it("parses a falah:// hadith URI with an underscore slug", () => {
		expect(parseRefUri("falah://hadith/riyad_assalihin/5")).toEqual({
			kind: "hadith",
			collection: "riyad_assalihin",
			number: "5",
		});
	});
});

describe("ayah_key helpers", () => {
	it("toAyahKey returns the starting ayah key", () => {
		expect(toAyahKey({ kind: "quran", surah: 2, ayah: 255 })).toBe("2:255");
		expect(toAyahKey({ kind: "quran", surah: 2, ayah: 255, toAyah: 257 })).toBe("2:255");
	});

	it("toAyahKeys expands a range", () => {
		expect(toAyahKeys({ kind: "quran", surah: 2, ayah: 255 })).toEqual(["2:255"]);
		expect(toAyahKeys({ kind: "quran", surah: 2, ayah: 255, toAyah: 257 })).toEqual([
			"2:255",
			"2:256",
			"2:257",
		]);
	});

	it("parseAyahKey round-trips a well-formed key", () => {
		expect(parseAyahKey("2:255")).toEqual({ surah: 2, ayah: 255 });
		expect(parseAyahKey(" 114:6 ")).toEqual({ surah: 114, ayah: 6 });
	});

	it.each(["2:0", "115:1", "2:287", "2:255-257", "abc", "", "2:", ":255", "2:255:1"])(
		"parseAyahKey rejects %s",
		(key) => {
			expect(parseAyahKey(key)).toBeNull();
		}
	);
});

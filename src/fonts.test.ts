import { describe, expect, it } from "vitest";
import {
	BUNDLED_FONTS,
	DEFAULT_FONT_BY_SCRIPT,
	FALLBACK_FAMILY,
	bundledFontsForScript,
	dedupeFamilies,
	familyFromFontFile,
	fontStackFor,
} from "./fonts";

describe("fontStackFor", () => {
	it("wraps a family with the naskh fallback and serif", () => {
		expect(fontStackFor("Amiri Quran")).toBe('"Amiri Quran", "Noto Naskh Arabic", serif');
	});
	it("returns just the fallback stack for an empty family", () => {
		expect(fontStackFor("")).toBe('"Noto Naskh Arabic", serif');
	});
	it("does not duplicate the fallback when it is the chosen family", () => {
		expect(fontStackFor("Noto Naskh Arabic")).toBe('"Noto Naskh Arabic", serif');
	});
});

describe("bundledFontsForScript", () => {
	it("offers uthmani fonts (incl. the universal fallback) but not indopak-only", () => {
		const fams = bundledFontsForScript("uthmani").map((f) => f.family);
		expect(fams).toContain("Amiri Quran");
		expect(fams).toContain("KFGQPC Uthmanic Hafs");
		expect(fams).toContain("Noto Naskh Arabic");
		expect(fams).not.toContain("PDMS Saleem QuranFont");
	});
	it("offers the indopak font (and fallback) but not uthmani-only fonts", () => {
		const fams = bundledFontsForScript("indopak").map((f) => f.family);
		expect(fams).toContain("PDMS Saleem QuranFont");
		expect(fams).toContain("Noto Naskh Arabic");
		expect(fams).not.toContain("Amiri Quran");
	});
});

describe("dedupeFamilies", () => {
	it("dedupes, drops blanks, and sorts", () => {
		expect(dedupeFamilies(["Beta", "Alpha", "Alpha", "   ", ""])).toEqual(["Alpha", "Beta"]);
	});
});

describe("familyFromFontFile", () => {
	it("strips directory and extension", () => {
		expect(familyFromFontFile("qdata/fonts/My-Quran.woff2")).toBe("My-Quran");
		expect(familyFromFontFile("Scheherazade.ttf")).toBe("Scheherazade");
	});
});

describe("defaults", () => {
	it("has a default family for both bundled scripts, and each exists in BUNDLED_FONTS", () => {
		const families = new Set(BUNDLED_FONTS.map((f) => f.family));
		for (const script of ["uthmani", "indopak"]) {
			const fam = DEFAULT_FONT_BY_SCRIPT[script];
			expect(fam).toBeTruthy();
			expect(families.has(fam)).toBe(true);
		}
		expect(FALLBACK_FAMILY).toBe("Noto Naskh Arabic");
	});
});

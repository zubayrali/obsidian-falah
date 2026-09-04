import { describe, expect, it } from "vitest";
import { parseQcfPage, qcfFontFile } from "./schema";

describe("QCF page schema", () => {
	it("accepts a valid page and enforces its expected number", () => {
		const page = { page: 1, font: "QCF4_Hafs_01", surahs: [], lines: [{ line: 1, words: [{ code: 1, char: "x", font: "QCF4_Hafs_01", type: "word" }] }] };
		expect(parseQcfPage(page, 1)).toBe(page);
		expect(() => parseQcfPage(page, 2)).toThrow(/page number/);
	});

	it("maps QCF font family names to archive files", () => {
		expect(qcfFontFile("QCF4_Hafs_07")).toBe("QCF4_Hafs_07_W.woff2");
		expect(qcfFontFile("QCF4_QBSML")).toBe("QCF4_QBSML.woff2");
		expect(() => qcfFontFile("Unknown")).toThrow(/Unsupported/);
	});
});

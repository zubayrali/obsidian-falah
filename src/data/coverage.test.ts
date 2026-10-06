import { describe, expect, it } from "vitest";
import { missingAyahCount, resourceMissingAyahs } from "./coverage";

describe("source coverage", () => {
	it("counts grouped tafsir coverage once", () => {
		expect(missingAyahCount([{ ayahKey: "2:1", ayahKeys: ["2:1", "2:2"], text: "Group" }, { ayahKey: "2:2", text: "Duplicate" }], 2, 3)).toBe(1);
	});
	it("rejects empty or wrong-chapter downloads before installation", () => {
		expect(() => missingAyahCount([], 1, 7)).toThrow("no usable content");
		expect(() => missingAyahCount([{ ayahKey: "2:1", text: "x" }], 1, 7)).toThrow("Unexpected verse key");
	});
	it("sums persisted gaps without treating unmeasured chapters as complete", () => {
		expect(resourceMissingAyahs({ missingAyahsBySurah: { 1: 0, 2: 4 } })).toBe(4);
		expect(resourceMissingAyahs()).toBe(0);
	});
});

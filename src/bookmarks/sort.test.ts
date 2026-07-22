import { describe, it, expect } from "vitest";
import { sortBookmarks } from "./sort";
import type { Bookmark } from "./schema";

const b = (anchor: string, added: number): Bookmark => ({ id: anchor, anchor, added });
const items = [
	b("falah://quran/2/255", 30),
	b("falah://quran/1/1", 10),
	b("falah://quran/1/5", 20),
];

describe("sortBookmarks", () => {
	it("added: newest first", () => {
		expect(sortBookmarks(items, "added").map(x => x.added)).toEqual([30, 20, 10]);
	});
	it("surah: by surah then ayah", () => {
		expect(sortBookmarks(items, "surah").map(x => x.anchor)).toEqual([
			"falah://quran/1/1", "falah://quran/1/5", "falah://quran/2/255",
		]);
	});
	it("manual: input order preserved, new array", () => {
		const out = sortBookmarks(items, "manual");
		expect(out).not.toBe(items);
		expect(out.map(x => x.added)).toEqual([30, 10, 20]);
	});
});

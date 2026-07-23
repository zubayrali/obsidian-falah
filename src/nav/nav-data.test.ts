import { describe, it, expect } from "vitest";
import nav from "../../assets/bundled-core/quran-nav.json";
import type { QuranNav } from "./schema";

const n = nav as unknown as QuranNav;

describe("bundled quran-nav.json integrity", () => {
	it("has the canonical counts", () => {
		expect(n.juz).toHaveLength(30);
		expect(n.hizb).toHaveLength(60);
		expect(n.rub).toHaveLength(240);
		expect(n.pages).toHaveLength(604);
		expect(n.sajdahs).toHaveLength(15);
		expect(n.ruku.length).toBeGreaterThan(500);
	});
	it("juz 1 and page 1 start at 1:1", () => {
		expect(n.juz[0]).toMatchObject({ surah: 1, ayah: 1 });
		expect(n.pages[0]).toMatchObject({ surah: 1, ayah: 1 });
	});
	it("every point is in range and arrays are sorted by position", () => {
		const ok = (s: number, a: number) => s >= 1 && s <= 114 && a >= 1 && a <= 286;
		const sorted = (arr: { surah: number; ayah: number }[]) =>
			arr.every((p, i) => i === 0 || p.surah > arr[i - 1].surah || (p.surah === arr[i - 1].surah && p.ayah >= arr[i - 1].ayah));
		for (const arr of [n.juz, n.hizb, n.rub, n.pages, n.ruku]) {
			expect(arr.every((p) => ok(p.surah, p.ayah))).toBe(true);
			expect(sorted(arr)).toBe(true);
		}
		expect(n.sajdahs.every((s) => ok(s.surah, s.ayah) && (s.type === "recommended" || s.type === "obligatory"))).toBe(true);
	});
});

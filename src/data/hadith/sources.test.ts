import { describe, expect, it } from "vitest";
import { AHMEDBASET_BOOKS, MHASHIM_BOOKS } from "./sources";

describe("hardcoded hadith catalogs", () => {
	it("AhmedBaset lists the nine books plus extras, all AR+EN", () => {
		expect(AHMEDBASET_BOOKS.length).toBeGreaterThanOrEqual(9);
		for (const e of AHMEDBASET_BOOKS) {
			expect(e.source).toBe("ahmedbaset");
			expect(e.languages).toContain("eng");
			expect(e.collection).toMatch(/^[a-z0-9_]+$/);
			expect(e.name.length).toBeGreaterThan(0);
		}
		expect(AHMEDBASET_BOOKS.map((e) => e.collection)).toContain("bukhari");
	});

	it("mhashim6 lists Arabic-only books", () => {
		expect(MHASHIM_BOOKS.length).toBeGreaterThanOrEqual(9);
		for (const e of MHASHIM_BOOKS) {
			expect(e.source).toBe("mhashim6");
			expect(e.languages).toEqual(["ara"]);
		}
	});
});

import { describe, expect, it } from "vitest";
import { HadithCoreLoader } from "./core";

describe("HadithCoreLoader (bundled Nawawi 40)", () => {
	const core = new HadithCoreLoader();

	it("bundles the nawawi collection with 40+ hadith, AR+EN on #1", () => {
		const c = core.get("nawawi");
		expect(c).toBeDefined();
		expect(c!.collection).toBe("nawawi");
		expect(c!.hadiths.length).toBeGreaterThanOrEqual(40);
		expect(c!.hadiths[0].arabic && c!.hadiths[0].arabic.length).toBeGreaterThan(0);
		expect(c!.hadiths[0].translation && c!.hadiths[0].translation.length).toBeGreaterThan(0);
	});

	it("lists the bundled collection and returns undefined for unknown", () => {
		expect(core.listCollections().map((c) => c.collection)).toContain("nawawi");
		expect(core.get("bukhari")).toBeUndefined();
	});
});

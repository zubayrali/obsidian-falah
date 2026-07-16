import { describe, expect, it } from "vitest";
import {
	SOURCE_LABELS,
	TIER_LABELS,
	annotateCatalogLabels,
	distinctLanguages,
	filterCatalog,
	languageDisplayName,
	UPDATE_AVAILABLE_SUFFIX,
} from "./settings-helpers";
import type { ResourceDescriptor } from "./data/schema";

function desc(id: string, name: string): ResourceDescriptor {
	return { id, type: "translation", name, language: "en", tier: "downloaded" };
}

function mk(over: Partial<ResourceDescriptor>): ResourceDescriptor {
	return {
		id: over.id ?? "x",
		type: over.type ?? "translation",
		name: over.name ?? "Name",
		language: over.language ?? "en",
		tier: over.tier ?? "downloaded",
		...over,
	};
}

describe("annotateCatalogLabels", () => {
	it("leaves labels unchanged when no updates are available", () => {
		const catalog = [desc("a", "Alpha"), desc("b", "Beta")];
		expect(annotateCatalogLabels(catalog, [])).toEqual([
			{ id: "a", label: "Alpha" },
			{ id: "b", label: "Beta" },
		]);
	});

	it("appends the update suffix only to matching ids", () => {
		const catalog = [desc("a", "Alpha"), desc("b", "Beta")];
		expect(annotateCatalogLabels(catalog, ["b"])).toEqual([
			{ id: "a", label: "Alpha" },
			{ id: "b", label: `Beta${UPDATE_AVAILABLE_SUFFIX}` },
		]);
	});

	it("is a no-op on an empty catalog", () => {
		expect(annotateCatalogLabels([], ["a"])).toEqual([]);
	});
});

describe("languageDisplayName", () => {
	it("maps an ISO 639-1 code to its English name", () => {
		expect(languageDisplayName("en")).toBe("English");
		expect(languageDisplayName("fr")).toBe("French");
		expect(languageDisplayName("ur")).toBe("Urdu");
	});
	it("title-cases a full lowercase language name (fawazahmed0 style)", () => {
		expect(languageDisplayName("english")).toBe("English");
		expect(languageDisplayName("bengali")).toBe("Bengali");
	});
	it("returns 'Unknown' for empty input", () => {
		expect(languageDisplayName("")).toBe("Unknown");
	});
});

describe("distinctLanguages", () => {
	it("de-duplicates and sorts by display name", () => {
		const cat = [
			mk({ id: "a", language: "fr" }),
			mk({ id: "b", language: "en" }),
			mk({ id: "c", language: "en" }),
			mk({ id: "d", language: "ar" }),
		];
		expect(distinctLanguages(cat)).toEqual([
			{ value: "ar", name: "Arabic" },
			{ value: "en", name: "English" },
			{ value: "fr", name: "French" },
		]);
	});
	it("is empty for an empty catalog", () => {
		expect(distinctLanguages([])).toEqual([]);
	});
});

describe("filterCatalog", () => {
	const cat = [
		mk({ id: "a", name: "Saheeh International", language: "en" }),
		mk({ id: "b", name: "Hamidullah", language: "fr" }),
		mk({ id: "c", name: "The Clear Quran", language: "en" }),
	];
	it("filters by case-insensitive name substring", () => {
		expect(filterCatalog(cat, { search: "clear" }).map((r) => r.id)).toEqual(["c"]);
	});
	it("filters by language", () => {
		expect(filterCatalog(cat, { language: "en" }).map((r) => r.id)).toEqual(["a", "c"]);
	});
	it("combines search and language (AND)", () => {
		expect(filterCatalog(cat, { search: "quran", language: "en" }).map((r) => r.id)).toEqual(["c"]);
	});
	it("returns all when no filters are given", () => {
		expect(filterCatalog(cat, {}).map((r) => r.id)).toEqual(["a", "b", "c"]);
	});
});

describe("label maps", () => {
	it("renders friendly source names", () => {
		expect(SOURCE_LABELS["fawazahmed0"]).toBe("fawazahmed0 (Quran CDN)");
		expect(SOURCE_LABELS["alquran-cloud"]).toBe("AlQuran.cloud");
		expect(SOURCE_LABELS["qul"]).toBe("QUL");
	});
	it("renders 'default' for the bundled tier", () => {
		expect(TIER_LABELS["bundled"]).toBe("default");
		expect(TIER_LABELS["downloaded"]).toBe("downloaded");
		expect(TIER_LABELS["user-import"]).toBe("imported");
	});
});

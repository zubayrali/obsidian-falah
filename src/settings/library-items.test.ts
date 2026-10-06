import { describe, expect, it } from "vitest";
import { mergeHadithCollections, mergeQuranResources } from "./library-items";
import type { ResourceDescriptor } from "../data/schema";

const resource = (id: string): ResourceDescriptor => ({ id, name: id, type: "translation", tier: "downloaded", language: "en", source: "qul" });

describe("Unified library", () => {
	it("keeps installed-only and imported Quran resources in the catalog without duplicates", () => {
		const rows = mergeQuranResources([resource("a"), resource("b")], [resource("a"), { ...resource("c"), source: undefined, tier: "user-import" }]);
		expect(rows.map((row) => row.id)).toEqual(["a", "c", "b"]);
	});
	it("excludes bundled Quran text and word packs from the resource catalog", () => {
		expect(mergeQuranResources([], [{ ...resource("core"), tier: "bundled" }, { ...resource("words"), cardinality: "per-word" }])).toEqual([]);
	});
	it("merges installed hadith languages and retains different providers separately", () => {
		const catalog = [{ source: "a", collection: "bukhari", name: "Bukhari", languages: ["ara"] }];
		const installed = [
			{ id: "a-bukhari-eng", source: "a", collection: "bukhari", name: "Bukhari", language: "eng" },
			{ id: "b-bukhari-ara", source: "b", collection: "bukhari", name: "Bukhari", language: "ara" },
		];
		const rows = mergeHadithCollections(catalog, installed);
		expect(rows).toHaveLength(2);
		expect(rows[0].languages).toEqual(["ara", "eng"]);
		expect(catalog[0].languages).toEqual(["ara"]);
		expect(mergeHadithCollections([], installed)).toHaveLength(2);
	});
});

import { describe, it, expect } from "vitest";
import {
	bookmarkId, lensKey, emptyStore, serializeStore, parseStore, findBookmark,
	BOOKMARKS_VERSION, type BookmarkStore,
} from "./schema";

describe("bookmark ids", () => {
	it("plain anchor id is the anchor", () => {
		expect(bookmarkId("falah://quran/2/255")).toBe("falah://quran/2/255");
		expect(lensKey()).toBe("");
	});
	it("lensed id disambiguates by edition", () => {
		const id = bookmarkId("falah://quran/2/255", { kind: "tafsir", editionId: "ar.ibnkathir" });
		expect(id).toBe("falah://quran/2/255#tafsir:ar.ibnkathir");
		expect(id).not.toBe(bookmarkId("falah://quran/2/255"));
	});
});

describe("serialize / parse", () => {
	it("round-trips a store", () => {
		const store: BookmarkStore = {
			version: BOOKMARKS_VERSION,
			groups: [{ id: "g1", name: "To memorize", order: 0, items: [
				{ id: "falah://quran/2/255", anchor: "falah://quran/2/255", note: "Ayat al-Kursi", added: 1000 },
			] }],
		};
		expect(parseStore(serializeStore(store))).toEqual(store);
	});
	it("garbage parses to an empty store, never throws", () => {
		expect(parseStore("not json")).toEqual(emptyStore());
		expect(parseStore("{}")).toEqual(emptyStore());
		expect(parseStore('{"version":1,"groups":"x"}')).toEqual(emptyStore());
	});
	it("emptyStore has the current version and no groups", () => {
		expect(emptyStore()).toEqual({ version: BOOKMARKS_VERSION, groups: [] });
	});
});

describe("findBookmark", () => {
	it("locates an item and its group by id", () => {
		const store = parseStore(serializeStore({
			version: BOOKMARKS_VERSION,
			groups: [{ id: "g1", name: "G", order: 0, items: [
				{ id: "a", anchor: "falah://quran/1/1", added: 1 },
			] }],
		}));
		expect(findBookmark(store, "a")?.item.anchor).toBe("falah://quran/1/1");
		expect(findBookmark(store, "missing")).toBeNull();
	});
});

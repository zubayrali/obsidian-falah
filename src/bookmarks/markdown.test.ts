import { describe, it, expect } from "vitest";
import { exportMarkdown, importText } from "./markdown";
import { BOOKMARKS_VERSION, type BookmarkStore } from "./schema";

const store: BookmarkStore = {
	version: BOOKMARKS_VERSION,
	groups: [
		{ id: "g1", name: "To memorize", order: 0, items: [
			{ id: "falah://quran/2/255", anchor: "falah://quran/2/255", note: "Ayat al-Kursi", added: 1 },
		] },
		{ id: "g2", name: "Hadith", order: 1, items: [
			{ id: "falah://hadith/bukhari/1", anchor: "falah://hadith/bukhari/1", added: 2 },
		] },
	],
};

describe("markdown export", () => {
	it("writes group headings and falah:// list items with notes", () => {
		const md = exportMarkdown(store);
		expect(md).toContain("# To memorize");
		expect(md).toContain("(falah://quran/2/255)");
		expect(md).toContain("Ayat al-Kursi");
		expect(md).toContain("# Hadith");
		expect(md).toContain("(falah://hadith/bukhari/1)");
	});
});

describe("import", () => {
	it("round-trips exported markdown back into groups+anchors", () => {
		const back = importText(exportMarkdown(store));
		expect(back.groups.map((g) => g.name)).toEqual(["To memorize", "Hadith"]);
		expect(back.groups[0].items[0].anchor).toBe("falah://quran/2/255");
		expect(back.groups[0].items[0].note).toBe("Ayat al-Kursi");
	});
	it("accepts a JSON store too", () => {
		const back = importText(JSON.stringify(store));
		expect(back.groups[0].items[0].anchor).toBe("falah://quran/2/255");
	});
	it("ignores non-falah links and malformed lines", () => {
		const md = "# G\n- [x](https://example.com)\n- not a list item\n- [v](falah://quran/1/1)";
		const back = importText(md);
		expect(back.groups[0].items.map((i) => i.anchor)).toEqual(["falah://quran/1/1"]);
	});
});

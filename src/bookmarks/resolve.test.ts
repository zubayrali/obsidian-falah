import { describe, it, expect } from "vitest";
import { resolveRow, type AvailabilitySnapshot } from "./resolve";

const snap: AvailabilitySnapshot = {
	editions: new Set(["ar.ibnkathir"]),
	collections: new Set(["bukhari"]),
};

describe("resolveRow", () => {
	it("plain verse resolves with no lens badge", () => {
		const s = resolveRow({ id: "a", anchor: "falah://quran/2/255", added: 0 }, snap);
		expect(s.anchorOk).toBe(true);
		expect(s.lensState).toBe("none");
		expect(s.label).toBe("Quran 2:255");
		expect(s.badge).toBeUndefined();
	});
	it("lens present + installed = ok", () => {
		const s = resolveRow(
			{ id: "a", anchor: "falah://quran/2/255", lens: { kind: "tafsir", editionId: "ar.ibnkathir" }, added: 0 },
			snap,
		);
		expect(s.lensState).toBe("ok");
	});
	it("lens present + uninstalled = dormant with a reinstall badge (not deleted)", () => {
		const s = resolveRow(
			{ id: "a", anchor: "falah://quran/2/255", lens: { kind: "tafsir", editionId: "en.gone" }, added: 0 },
			snap,
		);
		expect(s.lensState).toBe("dormant");
		expect(s.badge?.kind).toBe("lens-dormant");
		expect(s.badge).toEqual({ kind: "lens-dormant", editionId: "en.gone" });
	});
	it("hadith with uninstalled collection shows a stub badge but stays listed", () => {
		const s = resolveRow({ id: "a", anchor: "falah://hadith/muslim/1", added: 0 }, snap);
		expect(s.anchorOk).toBe(true);
		expect(s.badge?.kind).toBe("collection-missing");
		expect(s.badge).toEqual({ kind: "collection-missing", collection: "muslim" });
	});
	it("hadith with installed collection has no stub badge", () => {
		const s = resolveRow({ id: "a", anchor: "falah://hadith/bukhari/1", added: 0 }, snap);
		expect(s.anchorOk).toBe(true);
		expect(s.badge).toBeUndefined();
	});
	it("malformed anchor is flagged invalid, not a stub", () => {
		const s = resolveRow({ id: "a", anchor: "falah://quran/0/0", added: 0 }, snap);
		expect(s.anchorOk).toBe(false);
		expect(s.badge?.kind).toBe("invalid");
	});
});

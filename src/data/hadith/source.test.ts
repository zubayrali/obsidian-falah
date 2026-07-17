import { describe, expect, it, vi } from "vitest";
import { makeFakeIO } from "../testing";
import { ResourceStore } from "../content/resource-store";
import { InstallIndex } from "../content/install-index";
import { HadithCoreLoader } from "./core";
import { HadithResolver } from "./source";
import type { HadithCollection } from "./schema";
import { hadithCollectionId } from "./schema";

const bukhari: HadithCollection = {
	source: "fawazahmed0", collection: "bukhari", language: "eng", name: "Sahih al-Bukhari",
	hadiths: [{ number: 1, arabic: "إنما الأعمال", translation: "Actions are by intentions", narrator: "Umar", grades: [{ name: "Bukhari", grade: "Sahih" }] }],
};

function makeResolver(installed?: HadithCollection) {
	const io = makeFakeIO();
	const store = new ResourceStore(io);
	const index = new InstallIndex(io, "hdata/index.json");
	const core = new HadithCoreLoader();
	const live = { getHadith: vi.fn().mockResolvedValue({ ref: { kind: "hadith", collection: "x", number: "1" }, translation: "LIVE", externalUrl: "u" }) };
	const resolver = new HadithResolver(store, index, core, live);
	return { resolver, live, store, index, seed: async () => {
		if (installed) {
			const id = hadithCollectionId(installed.source, installed.collection, installed.language);
			await store.write("hadith", id, installed);
			await index.put({ id, type: "hadith-collection", name: installed.name, language: installed.language, tier: "downloaded", installedAt: 1, count: installed.hadiths.length, provenance: installed.source, meta: { collection: installed.collection } });
		}
	}};
}

describe("HadithResolver.getHadith", () => {
	it("resolves from an installed collection first (with narrator + grades)", async () => {
		const { resolver, live, seed } = makeResolver(bukhari);
		await seed();
		const r = await resolver.getHadith({ kind: "hadith", collection: "bukhari", number: "1" });
		expect(r.arabic).toBe("إنما الأعمال");
		expect(r.translation).toBe("Actions are by intentions");
		expect(r.narrator).toBe("Umar");
		expect(r.grades).toContain("Sahih");
		expect(live.getHadith).not.toHaveBeenCalled();
	});

	it("falls back to bundled Nawawi 40 when not installed", async () => {
		const { resolver, live } = makeResolver();
		const r = await resolver.getHadith({ kind: "hadith", collection: "nawawi", number: "1" });
		expect((r.arabic ?? "").length).toBeGreaterThan(0);
		expect(live.getHadith).not.toHaveBeenCalled();
	});

	it("falls back to the live provider when neither installed nor bundled", async () => {
		const { resolver, live } = makeResolver();
		const r = await resolver.getHadith({ kind: "hadith", collection: "muslim", number: "5" });
		expect(r.translation).toBe("LIVE");
		expect(live.getHadith).toHaveBeenCalledOnce();
	});
});

describe("HadithResolver.listBrowsable + bundled getCollection", () => {
	it("lists bundled Nawawi when nothing installed", async () => {
		const { resolver } = makeResolver();
		const list = await resolver.listBrowsable();
		const nawawi = list.find((b) => b.collection === "nawawi");
		expect(nawawi).toMatchObject({ tier: "bundled", id: "bundled-nawawi" });
		expect(nawawi!.count).toBeGreaterThanOrEqual(40);
	});

	it("getCollection resolves a bundled id via the core loader", async () => {
		const { resolver } = makeResolver();
		const c = await resolver.getCollection("bundled-nawawi");
		expect(c.collection).toBe("nawawi");
		expect(c.hadiths.length).toBeGreaterThanOrEqual(40);
	});

	it("lists an installed collection as downloaded and still resolves it", async () => {
		const { resolver, store, index } = makeResolver();
		const id = "fawazahmed0-bukhari-eng";
		await store.write("hadith", id, bukhari);
		await index.put({ id, type: "hadith-collection", name: "Sahih al-Bukhari", language: "eng", tier: "downloaded", provenance: "fawazahmed0", count: 1, installedAt: 1, meta: { collection: "bukhari" } });
		const list = await resolver.listBrowsable();
		expect(list.find((b) => b.id === id)).toMatchObject({ tier: "downloaded", collection: "bukhari" });
		const c = await resolver.getCollection(id);
		expect(c.collection).toBe("bukhari");
	});
});

describe("HadithResolver install/remove/list", () => {
	it("install writes store + index; listInstalled reflects it; remove clears it", async () => {
		const { resolver } = makeResolver();
		await resolver.install(
			{ id: hadithCollectionId("fawazahmed0", "bukhari", "eng"), source: "fawazahmed0", collection: "bukhari", language: "eng", name: "Sahih al-Bukhari", count: 1 },
			bukhari
		);
		let list = await resolver.listInstalled();
		expect(list.map((d) => d.collection)).toEqual(["bukhari"]);
		await resolver.remove(list[0].id);
		list = await resolver.listInstalled();
		expect(list).toEqual([]);
	});

	it("falls back to the id segment when meta.collection isn't a string", async () => {
		const { resolver, index } = makeResolver();
		// meta is Record<string, unknown>, so a malformed index entry can hold a
		// non-string here; it must never stringify into the collection name.
		await index.put({ id: "fawazahmed0-bukhari-eng", type: "hadith-collection", name: "Sahih al-Bukhari", language: "eng", tier: "downloaded", provenance: "fawazahmed0", count: 1, installedAt: 1, meta: { collection: { en: "bukhari" } } });
		const list = await resolver.listInstalled();
		expect(list.map((d) => d.collection)).toEqual(["bukhari"]);
	});
});

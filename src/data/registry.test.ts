import { describe, expect, it } from "vitest";
import { DataStore } from "./store";
import { makeFakeIO } from "./testing";
import { Registry } from "./registry";
import { CoreLoader } from "./core";
import type { CoreImportMap } from "./core";
import type { Ayah, Surah, TranslationVerse } from "./schema";
import { normalizeFawazEditions } from "./normalize";

function makeCore(): CoreLoader {
	const imports: CoreImportMap = {
		uthmani: () => Promise.resolve({ default: [] as Ayah[] }),
		indopak: () => Promise.resolve({ default: [] as Ayah[] }),
		clearquran: () => Promise.resolve({ default: [] as TranslationVerse[] }),
		surahs: () => Promise.resolve({ default: [] as Surah[] }),
	};
	return new CoreLoader(imports);
}

describe("Registry index round-trip", () => {
	it("returns no installed resources when index.json doesn't exist yet", async () => {
		const store = new DataStore(makeFakeIO());
		const registry = new Registry(makeFakeIO(), store, makeCore());
		expect(await registry.listInstalled()).toEqual([]);
	});

	it("recordSurahInstalled persists across a fresh Registry instance", async () => {
		const io = makeFakeIO();
		const store = new DataStore(io);
		const registry = new Registry(io, store, makeCore());
		const desc = {
			id: "fawazahmed0-eng-ahmedali",
			type: "translation" as const,
			name: "Ahmed Ali",
			language: "en",
			tier: "downloaded" as const,
			source: "fawazahmed0" as const,
			sourceResourceId: "eng-ahmedali",
			license: "Unlicense (public domain)",
		};
		await registry.recordSurahInstalled(desc, 1);
		await registry.recordSurahInstalled(desc, 2);

		const registry2 = new Registry(io, store, makeCore());
		const installed = await registry2.listInstalled();
		expect(installed).toEqual([
			{
				id: "fawazahmed0-eng-ahmedali",
				type: "translation",
				name: "Ahmed Ali",
				language: "en",
				tier: "downloaded",
				source: "fawazahmed0",
				sourceResourceId: "eng-ahmedali",
				version: undefined,
				license: "Unlicense (public domain)",
			},
		]);
	});

	it("writes index.json atomically (tmp then rename)", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		await registry.recordSurahInstalled(
			{ id: "r", type: "translation", name: "R", language: "en", tier: "downloaded" },
			1
		);
		const writeIdx = io.calls.indexOf("write:qdata/index.json.tmp");
		const renameIdx = io.calls.indexOf("rename:qdata/index.json.tmp->qdata/index.json");
		expect(writeIdx).toBeGreaterThanOrEqual(0);
		expect(renameIdx).toBeGreaterThan(writeIdx);
	});

	it("rebuilds a missing index by scanning qdata/, conservatively", async () => {
		const io = makeFakeIO({
			"qdata/translations/fawazahmed0-eng-ahmedali/001.json": "[]",
			"qdata/translations/fawazahmed0-eng-ahmedali/002.json": "[]",
		});
		const registry = new Registry(io, new DataStore(io), makeCore());
		const installed = await registry.listInstalled();
		expect(installed).toHaveLength(1);
		expect(installed[0].id).toBe("fawazahmed0-eng-ahmedali");
		expect(installed[0].type).toBe("translation");
	});

	it("round-trips a minted resource id through directory-scan rebuild (Fix A)", async () => {
		// The filesystem-safe id minted by normalize is used verbatim as the
		// directory name, so a directory scan must recover the exact same id.
		const [desc] = normalizeFawazEditions({
			eng_ahmedali: { name: "eng-ahmedali", author: "Ahmed Ali", language: "English" },
		});
		expect(desc.id).toBe("fawazahmed0-eng-ahmedali");
		const io = makeFakeIO();
		const store = new DataStore(io);
		// Write the resource under its own id, then simulate index.json loss.
		await store.writeSurahFile("translations", desc.id, 1, [{ ayahKey: "1:1", text: "x" }]);
		const registry = new Registry(io, store, makeCore());
		const installed = await registry.listInstalled();
		expect(installed.map((r) => r.id)).toEqual([desc.id]);
	});

	it("rebuilds when index.json is corrupt JSON", async () => {
		const io = makeFakeIO({
			"qdata/index.json": "{not json",
			"qdata/tafsirs/alquran-cloud-ar.muyassar/001.json": "[]",
		});
		const registry = new Registry(io, new DataStore(io), makeCore());
		const installed = await registry.listInstalled();
		expect(installed[0].id).toBe("alquran-cloud-ar.muyassar");
		expect(installed[0].type).toBe("tafsir");
	});
});

describe("Registry.listResources", () => {
	it("merges bundled-core descriptors with installed ones", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		await registry.recordSurahInstalled(
			{ id: "r", type: "translation", name: "R", language: "en", tier: "downloaded" },
			1
		);
		const ids = (await registry.listResources()).map((d) => d.id);
		expect(ids).toEqual(["core-uthmani", "core-indopak", "core-en-clearquran", "r"]);
	});

	it("still exposes bundled-core descriptors when index.json is absent (offline-first)", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		const ids = (await registry.listResources()).map((d) => d.id);
		expect(ids).toEqual(["core-uthmani", "core-indopak", "core-en-clearquran"]);
	});

	it("still exposes bundled-core descriptors when index.json is corrupt (offline-first)", async () => {
		const io = makeFakeIO({ "qdata/index.json": "{not json" });
		const registry = new Registry(io, new DataStore(io), makeCore());
		const ids = (await registry.listResources()).map((d) => d.id);
		expect(ids).toEqual(["core-uthmani", "core-indopak", "core-en-clearquran"]);
	});
});

describe("Registry surah/import/remove", () => {
	it("isSurahInstalled reflects recorded surahs", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		const desc = { id: "r", type: "translation" as const, name: "R", language: "en", tier: "downloaded" as const };
		expect(await registry.isSurahInstalled("r", 1)).toBe(false);
		await registry.recordSurahInstalled(desc, 1);
		expect(await registry.isSurahInstalled("r", 1)).toBe(true);
		expect(await registry.isSurahInstalled("r", 2)).toBe(false);
	});

	it("recordImport marks a user-import resource installed with its surahs", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		const desc = {
			id: "import-my-tafsir",
			type: "tafsir" as const,
			name: "My Tafsir",
			language: "en",
			tier: "user-import" as const,
			license: "Personal use only",
		};
		await registry.recordImport(desc, [1, 2]);
		const installed = await registry.listInstalled();
		expect(installed).toEqual([{ ...desc, source: undefined, sourceResourceId: undefined, version: undefined }]);
	});

	it("removeResource deletes both the index entry and the on-disk resource", async () => {
		const io = makeFakeIO({ "qdata/translations/r/001.json": "[]" });
		const store = new DataStore(io);
		const registry = new Registry(io, store, makeCore());
		await registry.recordSurahInstalled(
			{ id: "r", type: "translation", name: "R", language: "en", tier: "downloaded" },
			1
		);
		await registry.removeResource("r", "translations");
		expect(await registry.listInstalled()).toEqual([]);
		expect(await io.exists("qdata/translations/r/001.json")).toBe(false);
	});
});

describe("Registry.getCatalog", () => {
	const fixture = [
		{ id: "fawazahmed0-eng-ahmedali", type: "translation" as const, name: "Ahmed Ali", language: "en", tier: "downloaded" as const },
	];

	it("fetches and caches a fresh catalog atomically", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		const fetchCatalog = async () => fixture;
		const { resources, stale } = await registry.getCatalog("fawazahmed0", "translation", fetchCatalog);
		expect(resources).toEqual(fixture);
		expect(stale).toBe(false);
		expect(io.calls).toContain(
			"rename:qdata/catalog-fawazahmed0-translation.json.tmp->qdata/catalog-fawazahmed0-translation.json"
		);
	});

	it("reuses a fresh cache without re-fetching", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		let calls = 0;
		const fetchCatalog = async () => {
			calls++;
			return fixture;
		};
		await registry.getCatalog("fawazahmed0", "translation", fetchCatalog);
		await registry.getCatalog("fawazahmed0", "translation", fetchCatalog);
		expect(calls).toBe(1);
	});

	it("keys the cache by source AND type so a source serving two types doesn't self-overwrite (Fix E)", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		const translations = [
			{ id: "qul-1", type: "translation" as const, name: "T", language: "en", tier: "downloaded" as const },
		];
		const tafsirs = [
			{ id: "qul-2", type: "tafsir" as const, name: "F", language: "en", tier: "downloaded" as const },
		];
		let translationCalls = 0;
		let tafsirCalls = 0;
		// Fetch both types for the same source, then re-read each from cache.
		await registry.getCatalog("qul", "translation", async () => {
			translationCalls++;
			return translations;
		});
		await registry.getCatalog("qul", "tafsir", async () => {
			tafsirCalls++;
			return tafsirs;
		});
		const t = await registry.getCatalog("qul", "translation", async () => {
			translationCalls++;
			return translations;
		});
		const f = await registry.getCatalog("qul", "tafsir", async () => {
			tafsirCalls++;
			return tafsirs;
		});
		// Each type served from its own fresh cache — no cross-overwrite, no re-fetch.
		expect(t.resources).toEqual(translations);
		expect(f.resources).toEqual(tafsirs);
		expect(translationCalls).toBe(1);
		expect(tafsirCalls).toBe(1);
	});

	it("treats a cache older than 7 days as stale and re-fetches", async () => {
		const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
		const io = makeFakeIO({
			"qdata/catalog-fawazahmed0-translation.json": JSON.stringify({ fetchedAt: eightDaysAgo, resources: fixture }),
		});
		const registry = new Registry(io, new DataStore(io), makeCore());
		let calls = 0;
		const { stale } = await registry.getCatalog("fawazahmed0", "translation", async () => {
			calls++;
			return fixture;
		});
		expect(calls).toBe(1);
		expect(stale).toBe(false); // refreshed successfully, so no longer stale
	});

	it("falls back to the stale cache when the fetch fails (non-fatal)", async () => {
		const io = makeFakeIO({
			"qdata/catalog-fawazahmed0-translation.json": JSON.stringify({ fetchedAt: 0, resources: fixture }),
		});
		const registry = new Registry(io, new DataStore(io), makeCore());
		const { resources, stale } = await registry.getCatalog("fawazahmed0", "translation", async () => {
			throw new Error("offline");
		});
		expect(resources).toEqual(fixture);
		expect(stale).toBe(true);
	});

	it("returns an empty, stale result when there's no cache and the fetch fails", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		const { resources, stale } = await registry.getCatalog("fawazahmed0", "translation", async () => {
			throw new Error("offline");
		});
		expect(resources).toEqual([]);
		expect(stale).toBe(true);
	});

	it("treats a valid-JSON but wrong-shaped cache as no usable cache and re-fetches", async () => {
		const io = makeFakeIO({ "qdata/catalog-fawazahmed0-translation.json": "{}" });
		const registry = new Registry(io, new DataStore(io), makeCore());
		let calls = 0;
		const { resources, stale } = await registry.getCatalog("fawazahmed0", "translation", async () => {
			calls++;
			return fixture;
		});
		expect(calls).toBe(1);
		expect(resources).toEqual(fixture);
		expect(stale).toBe(false);
	});

	it("falls back to empty+stale when a wrong-shaped cache exists and the fetch fails", async () => {
		const io = makeFakeIO({ "qdata/catalog-fawazahmed0-translation.json": JSON.stringify({ fetchedAt: "x" }) });
		const registry = new Registry(io, new DataStore(io), makeCore());
		const { resources, stale } = await registry.getCatalog("fawazahmed0", "translation", async () => {
			throw new Error("offline");
		});
		expect(resources).toEqual([]);
		expect(stale).toBe(true);
	});
});

describe("Registry.updatesAvailable", () => {
	it("flags installed resources whose catalog version differs", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		await registry.recordSurahInstalled(
			{ id: "r", type: "translation", name: "R", language: "en", tier: "downloaded", version: "v1" },
			1
		);
		const catalog = [
			{ id: "r", type: "translation" as const, name: "R", language: "en", tier: "downloaded" as const, version: "v2" },
		];
		expect(await registry.updatesAvailable(catalog)).toEqual(["r"]);
	});

	it("does not flag when versions match or are unknown", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		await registry.recordSurahInstalled(
			{ id: "r", type: "translation", name: "R", language: "en", tier: "downloaded", version: "v1" },
			1
		);
		const sameVersion = [
			{ id: "r", type: "translation" as const, name: "R", language: "en", tier: "downloaded" as const, version: "v1" },
		];
		const noVersion = [{ id: "r", type: "translation" as const, name: "R", language: "en", tier: "downloaded" as const }];
		expect(await registry.updatesAvailable(sameVersion)).toEqual([]);
		expect(await registry.updatesAvailable(noVersion)).toEqual([]);
	});
});

describe("Registry.getCatalog force refresh", () => {
	it("bypasses a fresh cache when force is true", async () => {
		const io = makeFakeIO();
		const registry = new Registry(io, new DataStore(io), makeCore());
		let calls = 0;
		const fetchCatalog = async () => {
			calls++;
			return [];
		};
		await registry.getCatalog("fawazahmed0", "translation", fetchCatalog);
		await registry.getCatalog("fawazahmed0", "translation", fetchCatalog, { force: true });
		expect(calls).toBe(2);
	});
});

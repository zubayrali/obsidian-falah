import { describe, expect, it } from "vitest";
import { NotInstalledError, SchemaError } from "./schema";
import { DataStore, LRU_CAPACITY, categoryForType } from "./store";
import { makeFakeIO } from "./testing";

describe("categoryForType", () => {
	it.each([
		["quran-script", "quran"],
		["translation", "translations"],
		["tafsir", "tafsirs"],
		["recitation", "translations"],
	])("%s → %s", (type, category) => {
		expect(categoryForType(type as never)).toBe(category);
	});
});

describe("DataStore.loadSurahFile", () => {
	it("reads, parses, and caches a surah file", async () => {
		const io = makeFakeIO({
			"qdata/translations/fawazahmed0-eng-ahmedali/001.json": JSON.stringify([
				{ ayahKey: "1:1", text: "x" },
			]),
		});
		const store = new DataStore(io);
		const first = await store.loadSurahFile("translations", "fawazahmed0-eng-ahmedali", 1);
		const readCalls = io.calls.filter((c) => c.startsWith("read:")).length;
		const second = await store.loadSurahFile("translations", "fawazahmed0-eng-ahmedali", 1);
		expect(first).toEqual([{ ayahKey: "1:1", text: "x" }]);
		expect(second).toBe(first); // same cached reference
		expect(io.calls.filter((c) => c.startsWith("read:"))).toHaveLength(readCalls); // no re-read
	});

	it("throws NotInstalledError when the surah file is missing", async () => {
		const store = new DataStore(makeFakeIO());
		await expect(store.loadSurahFile("translations", "nope", 1)).rejects.toThrow(NotInstalledError);
	});

	it("throws SchemaError on invalid JSON", async () => {
		const io = makeFakeIO({ "qdata/translations/bad/001.json": "{not json" });
		const store = new DataStore(io);
		await expect(store.loadSurahFile("translations", "bad", 1)).rejects.toThrow(SchemaError);
	});

	it("throws SchemaError when the parsed content is not an array", async () => {
		const io = makeFakeIO({ "qdata/translations/bad/001.json": JSON.stringify({ not: "an array" }) });
		const store = new DataStore(io);
		await expect(store.loadSurahFile("translations", "bad", 1)).rejects.toThrow(SchemaError);
	});

	it("evicts the least-recently-used entry once capacity is exceeded", async () => {
		const initial: Record<string, string> = {};
		for (let i = 1; i <= LRU_CAPACITY + 1; i++) {
			initial[`qdata/translations/r/${String(i).padStart(3, "0")}.json`] = JSON.stringify([i]);
		}
		const io = makeFakeIO(initial);
		const store = new DataStore(io);
		for (let i = 1; i <= LRU_CAPACITY; i++) await store.loadSurahFile("translations", "r", i);
		// touch surah 1 again so it's most-recently-used, then push capacity+1 in
		await store.loadSurahFile("translations", "r", 1);
		await store.loadSurahFile("translations", "r", LRU_CAPACITY + 1);
		const readsBefore = io.calls.filter((c) => c.startsWith("read:")).length;
		await store.loadSurahFile("translations", "r", 1); // still cached (was refreshed)
		await store.loadSurahFile("translations", "r", 2); // was evicted (oldest untouched)
		const readsAfter = io.calls.filter((c) => c.startsWith("read:")).length;
		expect(readsAfter).toBe(readsBefore + 1); // only surah 2 re-read
	});
});

describe("DataStore.writeSurahFile", () => {
	it("writes atomically: tmp file first, then rename", async () => {
		const io = makeFakeIO();
		const store = new DataStore(io);
		await store.writeSurahFile("translations", "r", 1, [{ ayahKey: "1:1", text: "x" }]);
		const writeIdx = io.calls.indexOf("write:qdata/translations/r/001.json.tmp");
		const renameIdx = io.calls.indexOf(
			"rename:qdata/translations/r/001.json.tmp->qdata/translations/r/001.json"
		);
		expect(writeIdx).toBeGreaterThanOrEqual(0);
		expect(renameIdx).toBeGreaterThan(writeIdx);
	});

	it("creates the resource directory before writing", async () => {
		const io = makeFakeIO();
		const store = new DataStore(io);
		await store.writeSurahFile("translations", "r", 1, []);
		expect(io.calls).toContain("mkdir:qdata/translations/r");
	});

	it("makes the written data immediately readable (cached, no re-read)", async () => {
		const io = makeFakeIO();
		const store = new DataStore(io);
		await store.writeSurahFile("translations", "r", 1, [{ ayahKey: "1:1", text: "x" }]);
		const readsBefore = io.calls.filter((c) => c.startsWith("read:")).length;
		const loaded = await store.loadSurahFile("translations", "r", 1);
		expect(loaded).toEqual([{ ayahKey: "1:1", text: "x" }]);
		expect(io.calls.filter((c) => c.startsWith("read:"))).toHaveLength(readsBefore);
	});
});

describe("DataStore.removeResource", () => {
	it("removes the resource's entire directory", async () => {
		const io = makeFakeIO({
			"qdata/translations/r/001.json": "[]",
			"qdata/translations/r/002.json": "[]",
		});
		const store = new DataStore(io);
		await store.removeResource("translations", "r");
		expect(await io.exists("qdata/translations/r/001.json")).toBe(false);
		expect(await io.exists("qdata/translations/r/002.json")).toBe(false);
	});

	it("is a no-op when the resource doesn't exist", async () => {
		const io = makeFakeIO();
		const store = new DataStore(io);
		await expect(store.removeResource("translations", "nope")).resolves.toBeUndefined();
	});

	it("evicts cached surah files so a removed resource doesn't serve stale cache", async () => {
		const io = makeFakeIO();
		const store = new DataStore(io);
		// writeSurahFile caches the parsed data in the LRU.
		await store.writeSurahFile("tafsirs", "t1", 1, [{ ayahKey: "1:1", text: "cached" }]);
		await store.removeResource("tafsirs", "t1");
		// Without eviction this would return the cached array instead of throwing.
		await expect(store.loadSurahFile("tafsirs", "t1", 1)).rejects.toThrow(NotInstalledError);
	});
});

describe("DataStore.ingestPack", () => {
	it("writes one atomic file per surah and reports what was installed", async () => {
		const io = makeFakeIO();
		const store = new DataStore(io);
		const bySurah = new Map([
			[1, [{ ayahKey: "1:1", text: "a" }, { ayahKey: "1:2", text: "b" }]],
			[2, [{ ayahKey: "2:1", text: "c" }]],
		]);
		const descriptor = {
			id: "import-my-tafsir",
			type: "tafsir" as const,
			name: "My Tafsir",
			language: "en",
			tier: "user-import" as const,
		};
		const result = await store.ingestPack("tafsirs", { descriptor, bySurah });
		expect(result).toEqual({ descriptor, surahs: [1, 2] });
		expect(JSON.parse(await io.read("qdata/tafsirs/import-my-tafsir/001.json"))).toEqual(
			bySurah.get(1)
		);
		expect(JSON.parse(await io.read("qdata/tafsirs/import-my-tafsir/002.json"))).toEqual(
			bySurah.get(2)
		);
	});
});

describe("DataStore.scanQdata", () => {
	it("maps directories to resources and files to installed surahs", async () => {
		const io = makeFakeIO({
			"qdata/translations/fawazahmed0-eng-ahmedali/001.json": "[]",
			"qdata/translations/fawazahmed0-eng-ahmedali/002.json": "[]",
			"qdata/tafsirs/alquran-cloud-ar.muyassar/001.json": "[]",
		});
		const store = new DataStore(io);
		expect(await store.scanQdata()).toEqual({
			quran: {},
			translations: { "fawazahmed0-eng-ahmedali": [1, 2] },
			tafsirs: { "alquran-cloud-ar.muyassar": [1] },
		});
	});

	it("returns empty categories when qdata/ doesn't exist yet", async () => {
		const store = new DataStore(makeFakeIO());
		expect(await store.scanQdata()).toEqual({ quran: {}, translations: {}, tafsirs: {} });
	});
});

describe("DataStore.cleanupOrphanedTmp", () => {
	it("removes leftover .tmp files from a crashed write", async () => {
		const io = makeFakeIO({
			"qdata/translations/r/001.json": "[]",
			"qdata/translations/r/002.json.tmp": "[",
		});
		const store = new DataStore(io);
		await store.cleanupOrphanedTmp();
		expect(await io.exists("qdata/translations/r/002.json.tmp")).toBe(false);
		expect(await io.exists("qdata/translations/r/001.json")).toBe(true);
	});
});

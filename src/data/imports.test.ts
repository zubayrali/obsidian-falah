import { describe, expect, it } from "vitest";
import { DataStore } from "./store";
import { Registry } from "./registry";
import { CoreLoader } from "./core";
import type { CoreImportMap } from "./core";
import { makeFakeIO } from "./testing";
import { scanImportsFolder } from "./imports";
import type { Ayah, Surah, TranslationVerse } from "./schema";

function makeCore(): CoreLoader {
	const imports: CoreImportMap = {
		uthmani: () => Promise.resolve({ default: [] as Ayah[] }),
		indopak: () => Promise.resolve({ default: [] as Ayah[] }),
		clearquran: () => Promise.resolve({ default: [] as TranslationVerse[] }),
		surahs: () => Promise.resolve({ default: [] as Surah[] }),
	};
	return new CoreLoader(imports);
}

function deps(files: Record<string, string>) {
	const io = makeFakeIO(files);
	const store = new DataStore(io);
	const registry = new Registry(io, store, makeCore());
	return { io, store, registry };
}

const validPack = JSON.stringify({
	id: "my-tafsir",
	type: "tafsir",
	name: "My Tafsir",
	language: "en",
	verses: [
		{ ayahKey: "1:1", text: "First." },
		{ ayahKey: "1:2", text: "Second." },
		{ ayahKey: "2:1", text: "Third." },
	],
});

describe("scanImportsFolder", () => {
	it("returns an empty result when the imports/ folder is absent", async () => {
		const d = deps({});
		expect(await scanImportsFolder(d)).toEqual({ ok: [], failed: [] });
	});

	it("ingests a valid pack and records it in the registry", async () => {
		const d = deps({ "imports/my-tafsir.json": validPack });
		const result = await scanImportsFolder(d);
		expect(result.ok).toEqual(["my-tafsir.json"]);
		expect(result.failed).toEqual([]);

		const installed = await d.registry.listInstalled();
		expect(installed).toHaveLength(1);
		expect(installed[0]).toMatchObject({
			id: "import-my-tafsir",
			type: "tafsir",
			name: "My Tafsir",
			tier: "user-import",
		});
		// verses written to disk under the tafsirs category, one file per surah
		expect(await d.io.exists("qdata/tafsirs/import-my-tafsir/001.json")).toBe(true);
		expect(await d.io.exists("qdata/tafsirs/import-my-tafsir/002.json")).toBe(true);
	});

	it("skips a malformed pack, reports it, and does not abort the scan", async () => {
		const d = deps({
			"imports/broken.json": "{not json",
			"imports/good.json": validPack,
		});
		const result = await scanImportsFolder(d);
		expect(result.ok).toEqual(["good.json"]);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0]).toContain("broken.json");
		// the good pack still got imported despite the broken one
		expect((await d.registry.listInstalled()).map((r) => r.id)).toEqual(["import-my-tafsir"]);
	});

	it("reports a pack with an unknown type as failed", async () => {
		const d = deps({ "imports/wrong.json": JSON.stringify({ type: "recitation", id: "x", name: "X", language: "en", verses: [] }) });
		const result = await scanImportsFolder(d);
		expect(result.ok).toEqual([]);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0]).toContain("wrong.json");
	});

	it("ignores non-JSON files in the imports/ folder", async () => {
		const d = deps({ "imports/readme.txt": "hello", "imports/my-tafsir.json": validPack });
		const result = await scanImportsFolder(d);
		expect(result.ok).toEqual(["my-tafsir.json"]);
	});
});

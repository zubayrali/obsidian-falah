/* eslint-disable obsidianmd/hardcoded-config-path -- makeFileIO takes baseDir as an
   opaque argument and never derives it; production passes manifest.dir, which Obsidian
   already resolves against the user's configured config folder. These are fixtures
   picking one concrete baseDir to assert prefixing against, not a config-path lookup. */
import { describe, expect, it } from "vitest";
import { makeFetchJson, makeFileIO } from "./obsidian-io";
import type { DataAdapterLike, RequestUrlLike } from "./obsidian-io";
import { DataError, NetworkError } from "./schema";

/** In-memory DataAdapter fake. Stores absolute (baseDir-prefixed) paths exactly as
 *  the FileIO shim passes them, so the tests assert real path-prefixing behavior. */
function fakeAdapter(seed?: {
	files?: Record<string, string>;
	folders?: Set<string>;
}): DataAdapterLike & { calls: string[] } {
	const files = new Map<string, string>(Object.entries(seed?.files ?? {}));
	const folders = new Set<string>(seed?.folders ?? []);
	const calls: string[] = [];
	return {
		calls,
		async read(path) {
			const v = files.get(path);
			if (v === undefined) throw new Error(`no such file: ${path}`);
			return v;
		},
		async write(path, data) {
			files.set(path, data);
		},
		async exists(path) {
			return files.has(path) || folders.has(path);
		},
		async mkdir(path) {
			folders.add(path);
		},
		async remove(path) {
			calls.push(`remove:${path}`);
			files.delete(path);
		},
		async rmdir(path, recursive) {
			calls.push(`rmdir:${path}:${recursive}`);
			folders.delete(path);
		},
		async rename(oldPath, newPath) {
			const v = files.get(oldPath);
			if (v !== undefined) {
				files.set(newPath, v);
				files.delete(oldPath);
			}
		},
		async stat(path) {
			if (folders.has(path)) return { type: "folder" };
			if (files.has(path)) return { type: "file" };
			return null;
		},
		async list(path) {
			const prefix = path + "/";
			const filesOut = [...files.keys()].filter(
				(k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")
			);
			const foldersOut = [...folders].filter(
				(k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")
			);
			return { files: filesOut, folders: foldersOut };
		},
	};
}

describe("makeFileIO", () => {
	it("write then read round-trips through the adapter", async () => {
		const adapter = fakeAdapter();
		const io = makeFileIO(adapter, ".obsidian/plugins/qirtaas");
		await io.write("qdata/translations/x/001.json", "[1,2,3]");
		expect(await io.read("qdata/translations/x/001.json")).toBe("[1,2,3]");
	});

	it("prefixes every path with baseDir", async () => {
		const adapter = fakeAdapter();
		const io = makeFileIO(adapter, ".obsidian/plugins/qirtaas");
		await io.write("qdata/index.json", "{}");
		// The adapter stores under the absolute, baseDir-prefixed key.
		expect(await adapter.exists(".obsidian/plugins/qirtaas/qdata/index.json")).toBe(true);
		expect(await adapter.exists("qdata/index.json")).toBe(false);
	});

	it("rename overwrites an existing destination (Obsidian's rename would refuse)", async () => {
		const adapter = fakeAdapter({ files: { "qdata/index.json": "old", "qdata/index.json.tmp": "new" } });
		// Reproduce Obsidian: rename throws if the destination already exists.
		const base = adapter.rename.bind(adapter);
		adapter.rename = async (oldPath, newPath) => {
			if (await adapter.exists(newPath)) throw new Error("destination file already exists");
			await base(oldPath, newPath);
		};
		const io = makeFileIO(adapter, "");
		await expect(io.rename("qdata/index.json.tmp", "qdata/index.json")).resolves.toBeUndefined();
		expect(await io.read("qdata/index.json")).toBe("new");
	});

	it("leaves paths unprefixed when baseDir is empty (no leading slash)", async () => {
		const adapter = fakeAdapter();
		const io = makeFileIO(adapter, "");
		await io.write("qdata/index.json", "{}");
		expect(await adapter.exists("qdata/index.json")).toBe(true);
		expect(await adapter.exists("/qdata/index.json")).toBe(false);
	});

	it("list() adapts Obsidian's full-path return into relative names", async () => {
		const base = ".obsidian/plugins/qirtaas";
		const adapter = fakeAdapter({
			files: {
				[`${base}/qdata/translations/en.sahih/001.json`]: "[]",
				[`${base}/qdata/translations/en.sahih/002.json`]: "[]",
			},
			folders: new Set([`${base}/qdata/translations/en.sahih`]),
		});
		const io = makeFileIO(adapter, base);

		const inDir = await io.list("qdata/translations/en.sahih");
		expect(inDir.files.sort()).toEqual(["001.json", "002.json"]);
		expect(inDir.folders).toEqual([]);

		const inParent = await io.list("qdata/translations");
		expect(inParent.folders).toEqual(["en.sahih"]);
		expect(inParent.files).toEqual([]);
	});

	it("remove() takes the folder-delete path for a directory", async () => {
		const base = "b";
		const adapter = fakeAdapter({ folders: new Set([`${base}/qdata/quran/uthmani`]) });
		const io = makeFileIO(adapter, base);
		await io.remove("qdata/quran/uthmani");
		expect(adapter.calls).toContain(`rmdir:${base}/qdata/quran/uthmani:true`);
		expect(adapter.calls.some((c) => c.startsWith("remove:"))).toBe(false);
	});

	it("remove() takes the file-delete path for a file", async () => {
		const base = "b";
		const adapter = fakeAdapter({ files: { [`${base}/qdata/x.json.tmp`]: "{}" } });
		const io = makeFileIO(adapter, base);
		await io.remove("qdata/x.json.tmp");
		expect(adapter.calls).toContain(`remove:${base}/qdata/x.json.tmp`);
		expect(adapter.calls.some((c) => c.startsWith("rmdir:"))).toBe(false);
	});

	it("remove() is a no-op when the path doesn't exist", async () => {
		const adapter = fakeAdapter();
		const io = makeFileIO(adapter, "b");
		await io.remove("qdata/missing");
		expect(adapter.calls).toEqual([]);
	});
});

describe("makeFetchJson", () => {
	it("returns the parsed JSON body on a 200", async () => {
		const requestUrl: RequestUrlLike = async () => ({ status: 200, json: { ok: true } });
		const fetchJson = makeFetchJson(requestUrl);
		expect(await fetchJson("https://example.test/x")).toEqual({ ok: true });
	});

	it("throws a typed NetworkError (instanceof DataError) on a non-200", async () => {
		const requestUrl: RequestUrlLike = async () => ({ status: 404, json: null });
		const fetchJson = makeFetchJson(requestUrl);
		await expect(fetchJson("https://example.test/missing")).rejects.toBeInstanceOf(NetworkError);
		await expect(fetchJson("https://example.test/missing")).rejects.toBeInstanceOf(DataError);
	});

	it("treats any non-2xx (e.g. 301, 500) as a failure", async () => {
		for (const status of [301, 399, 400, 500]) {
			const requestUrl: RequestUrlLike = async () => ({ status, json: {} });
			const fetchJson = makeFetchJson(requestUrl);
			await expect(fetchJson("https://example.test/x")).rejects.toBeInstanceOf(NetworkError);
		}
	});

	it("accepts any 2xx (e.g. 204) as success", async () => {
		const requestUrl: RequestUrlLike = async () => ({ status: 204, json: null });
		const fetchJson = makeFetchJson(requestUrl);
		expect(await fetchJson("https://example.test/x")).toBeNull();
	});
});

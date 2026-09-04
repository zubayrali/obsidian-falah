import { describe, expect, it, vi } from "vitest";
import { QcfStore, type QcfAdapter } from "./store";

function adapter(): QcfAdapter & { text: Map<string, string>; binary: Map<string, ArrayBuffer> } {
	const text = new Map<string, string>();
	const binary = new Map<string, ArrayBuffer>();
	const folders = new Set<string>();
	return {
		text,
		binary,
		read: async (path) => text.get(path) ?? "",
		write: async (path, data) => { text.set(path, data); },
		readBinary: async (path) => binary.get(path) ?? new ArrayBuffer(0),
		writeBinary: async (path, data) => { binary.set(path, data); },
		exists: async (path) => text.has(path) || binary.has(path) || folders.has(path),
		mkdir: async (path) => { folders.add(path); },
		list: async (path) => ({
			files: [...text.keys(), ...binary.keys()].filter((item) => item.startsWith(`${path}/`)),
			folders: [],
		}),
	};
}

describe("QCF lazy cache", () => {
	it("downloads a page once, persists it, and reports cached pages", async () => {
		const io = adapter();
		const response = { page: 42, font: "QCF4_Hafs_04", surahs: [], lines: [] };
		const request = vi.fn(async () => ({ status: 200, json: response, arrayBuffer: new ArrayBuffer(0) }));
		const store = new QcfStore(io, "plugins/falah", request);

		expect(await store.getPage(42)).toEqual(response);
		expect(await store.getPage(42)).toEqual(response);
		expect(request).toHaveBeenCalledTimes(1);
		expect(io.text.has("plugins/falah/qcf/pages/042.json")).toBe(true);
		expect(await store.cacheStatus()).toMatchObject({ pages: 1, fonts: 0, complete: false });
	});

	it("rejects failed page downloads without caching them", async () => {
		const io = adapter();
		const store = new QcfStore(io, "", async () => ({ status: 404, json: null, arrayBuffer: new ArrayBuffer(0) }));
		await expect(store.getPage(604)).rejects.toThrow(/HTTP 404/);
		expect(io.text.size).toBe(0);
	});
});

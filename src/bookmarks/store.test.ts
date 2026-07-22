import { describe, it, expect, beforeEach } from "vitest";
import { BookmarkStoreService } from "./store";
import type { FileIO } from "../data/store";

function memIO(seed: Record<string, string> = {}): FileIO & { files: Record<string, string> } {
	const files = { ...seed };
	return {
		files,
		async read(p) { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
		async write(p, d) { files[p] = d; },
		async exists(p) { return p in files; },
		async mkdir() {},
		async remove(p) { delete files[p]; },
		async rename(a, b) { files[b] = files[a]; delete files[a]; },
		async list() { return { files: [], folders: [] }; },
	};
}

describe("BookmarkStoreService", () => {
	let io: ReturnType<typeof memIO>;
	let svc: BookmarkStoreService;
	beforeEach(async () => {
		io = memIO();
		svc = new BookmarkStoreService(io, "Falah/bookmarks.json", () => 42);
		await svc.load();
	});

	it("load on a missing file starts empty", () => {
		expect(svc.list()).toEqual([]);
	});

	it("add creates the default group, persists, and fires onChange", async () => {
		let fired = 0;
		svc.onChange(() => fired++);
		const b = await svc.add({ anchor: "falah://quran/2/255", note: "AK" });
		expect(b.id).toBe("falah://quran/2/255");
		expect(b.added).toBe(42);
		expect(svc.list()[0].name).toBe("Bookmarks");
		expect(svc.has("falah://quran/2/255")).toBe(true);
		expect(fired).toBe(1);
		expect(io.files["Falah/bookmarks.json"]).toContain("falah://quran/2/255");
	});

	it("adding a duplicate anchor does not create a second item", async () => {
		await svc.add({ anchor: "falah://quran/2/255" });
		await svc.add({ anchor: "falah://quran/2/255" });
		expect(svc.list()[0].items).toHaveLength(1);
	});

	it("plain and lensed anchors coexist as distinct items", async () => {
		await svc.add({ anchor: "falah://quran/2/255" });
		await svc.add({ anchor: "falah://quran/2/255", lens: { kind: "tafsir", editionId: "ar.ibnkathir" } });
		expect(svc.list()[0].items).toHaveLength(2);
	});

	it("remove deletes by id and persists", async () => {
		const b = await svc.add({ anchor: "falah://quran/1/1" });
		await svc.remove(b.id);
		expect(svc.has("falah://quran/1/1")).toBe(false);
	});

	it("reload reads persisted state back", async () => {
		await svc.add({ anchor: "falah://quran/1/1", group: "Juz Amma" });
		const svc2 = new BookmarkStoreService(io, "Falah/bookmarks.json", () => 42);
		await svc2.load();
		expect(svc2.list().find((g) => g.name === "Juz Amma")?.items[0].anchor).toBe("falah://quran/1/1");
	});
});

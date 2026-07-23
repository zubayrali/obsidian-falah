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

	describe("collection management", () => {
		it("list() returns groups sorted by order", async () => {
			await svc.createGroup("B");
			await svc.createGroup("A");
			await svc.setGroupOrder([svc.list().find(g => g.name === "A")!.id, svc.list().find(g => g.name === "B")!.id]);
			expect(svc.list().map(g => g.name)).toEqual(["A", "B"]);
		});
		it("createGroup reuses an existing name, persists", async () => {
			const a = await svc.createGroup("Juz Amma");
			const b = await svc.createGroup("Juz Amma");
			expect(a.id).toBe(b.id);
			expect(svc.list().filter(g => g.name === "Juz Amma")).toHaveLength(1);
		});
		it("renameGroup changes the name", async () => {
			const g = await svc.createGroup("Old");
			await svc.renameGroup(g.id, "New");
			expect(svc.list().find(x => x.id === g.id)!.name).toBe("New");
		});
		it("deleteGroup moves its items into the default group, never deletes them", async () => {
			const g = await svc.createGroup("Juz Amma");
			await svc.add({ anchor: "falah://quran/112/1", group: "Juz Amma" });
			await svc.deleteGroup(g.id);
			expect(svc.list().some(x => x.name === "Juz Amma")).toBe(false);
			expect(svc.has("falah://quran/112/1")).toBe(true);
			expect(svc.list().find(x => x.name === "Bookmarks")!.items.map(i => i.anchor)).toContain("falah://quran/112/1");
		});
		it("deleteGroup refuses to delete the default group", async () => {
			await svc.add({ anchor: "falah://quran/1/1" }); // creates default
			const def = svc.list().find(g => g.name === "Bookmarks")!;
			await svc.deleteGroup(def.id);
			expect(svc.list().some(g => g.name === "Bookmarks")).toBe(true);
		});
		it("setCollapsed persists the collapsed flag on a group", async () => {
			const g = await svc.createGroup("Juz Amma");
			await svc.setCollapsed(g.id, true);
			expect(svc.list().find((x) => x.id === g.id)!.collapsed).toBe(true);
		});
		it("moveItem reassigns a bookmark to another collection", async () => {
			const b = await svc.add({ anchor: "falah://quran/2/255" });
			const target = await svc.createGroup("Duas");
			await svc.moveItem(b.id, target.id);
			expect(svc.list().find(g => g.name === "Bookmarks")!.items).toHaveLength(0);
			expect(svc.list().find(g => g.id === target.id)!.items.map(i => i.anchor)).toContain("falah://quran/2/255");
		});
		it("moveItem preserves favourite status: item stays in favourites() and lands in the target group", async () => {
			const b = await svc.add({ anchor: "falah://quran/2/255" });
			await svc.setFavourite(b.anchor, true);
			const target = await svc.createGroup("Duas");
			await svc.moveItem(b.id, target.id);
			expect(svc.favourites().map(i => i.anchor)).toContain("falah://quran/2/255");
			expect(svc.list().find(g => g.id === target.id)!.items.map(i => i.anchor)).toContain("falah://quran/2/255");
		});
		it("ensureGroup assigns a fresh max+1 order, never colliding with a survivor after a delete", async () => {
			await svc.createGroup("A"); // order 0
			const b = await svc.createGroup("B"); // order 1
			await svc.deleteGroup(b.id); // moves B's (empty) items into "Bookmarks", created at order 2
			await svc.createGroup("C"); // must not collide with "A" (order 0) or "Bookmarks" (order 2)
			const orders = svc.list().map(g => g.order);
			expect(new Set(orders).size).toBe(orders.length); // all unique
			expect(svc.list().find(g => g.name === "C")!.order).toBe(3);
		});
	});

	describe("configurable default collection", () => {
		it("add() with no group falls back to the configured default, not the hardcoded one", async () => {
			svc.setDefaultGroup("Duas");
			const b = await svc.add({ anchor: "falah://quran/2/255" });
			expect(svc.list().find(g => g.items.some(i => i.id === b.id))!.name).toBe("Duas");
		});
		it("setFavourite's create-path lands in the configured default", async () => {
			svc.setDefaultGroup("Duas");
			await svc.setFavourite("falah://quran/3/3", true);
			expect(svc.list().find(g => g.name === "Duas")!.items.map(i => i.anchor)).toContain("falah://quran/3/3");
		});
		it("deleteGroup refuses to delete the configured default group, even if it isn't named 'Bookmarks'", async () => {
			svc.setDefaultGroup("Duas");
			const duas = await svc.createGroup("Duas");
			await svc.deleteGroup(duas.id);
			expect(svc.list().some(g => g.name === "Duas")).toBe(true);
		});
		it("deleting the non-default 'Bookmarks' group is allowed and moves its items into the configured default", async () => {
			svc.setDefaultGroup("Duas");
			const bookmarks = await svc.createGroup("Bookmarks");
			await svc.add({ anchor: "falah://quran/4/4", group: "Bookmarks" });
			await svc.deleteGroup(bookmarks.id);
			expect(svc.list().some(g => g.name === "Bookmarks")).toBe(false);
			expect(svc.list().find(g => g.name === "Duas")!.items.map(i => i.anchor)).toContain("falah://quran/4/4");
		});
		it("without setDefaultGroup, default stays 'Bookmarks' (existing behaviour preserved)", async () => {
			const b = await svc.add({ anchor: "falah://quran/5/5" });
			expect(svc.list().find(g => g.items.some(i => i.id === b.id))!.name).toBe("Bookmarks");
		});
	});

	describe("favourites", () => {
		it("setFavourite(on) on a new anchor creates a bookmark in default and flags it", async () => {
			await svc.setFavourite("falah://quran/2/255", true);
			expect(svc.isFavourite("falah://quran/2/255")).toBe(true);
			expect(svc.list().find(g => g.name === "Bookmarks")!.items[0].favourite).toBe(true);
			expect(svc.favourites().map(i => i.anchor)).toEqual(["falah://quran/2/255"]);
		});
		it("setFavourite(off) keeps the bookmark, clears the flag", async () => {
			const b = await svc.add({ anchor: "falah://quran/1/1", group: "Duas" });
			await svc.setFavourite(b.anchor, true);
			await svc.setFavourite(b.anchor, false);
			expect(svc.isFavourite(b.anchor)).toBe(false);
			expect(svc.has(b.anchor)).toBe(true); // still bookmarked
			expect(svc.favourites()).toHaveLength(0);
		});
		it("setFavourite(off) on a non-bookmarked anchor is a no-op (creates nothing)", async () => {
			await svc.setFavourite("falah://quran/9/9", false);
			expect(svc.has("falah://quran/9/9")).toBe(false);
		});
	});
});

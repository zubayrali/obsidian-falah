import { describe, expect, it } from "vitest";
import { makeFakeIO } from "../testing";
import { InstallIndex } from "./install-index";

const entry = (id: string) => ({
	id, type: "hadith-collection", name: id, language: "eng",
	tier: "downloaded" as const, installedAt: 1000, count: 40,
});

describe("InstallIndex", () => {
	it("put/get/list round-trips with an atomic write", async () => {
		const io = makeFakeIO();
		const idx = new InstallIndex(io, "hdata/index.json");
		await idx.put(entry("fawazahmed0-nawawi-eng"));
		expect(io.calls.some((c) => c.startsWith("rename:hdata/index.json.tmp->hdata/index.json"))).toBe(true);
		expect(await idx.get("fawazahmed0-nawawi-eng")).toMatchObject({ count: 40, language: "eng" });
		expect(await idx.list()).toHaveLength(1);
	});

	it("remove deletes an entry", async () => {
		const io = makeFakeIO();
		const idx = new InstallIndex(io, "hdata/index.json");
		await idx.put(entry("a"));
		await idx.remove("a");
		expect(await idx.get("a")).toBeUndefined();
		expect(await idx.list()).toEqual([]);
	});

	it("treats a corrupt index as empty (never throws to callers)", async () => {
		const io = makeFakeIO({ "hdata/index.json": "{garbage" });
		const idx = new InstallIndex(io, "hdata/index.json");
		expect(await idx.list()).toEqual([]);
	});

	it("treats a wrong-shaped index as empty", async () => {
		const io = makeFakeIO({ "hdata/index.json": JSON.stringify({ version: 1 }) });
		const idx = new InstallIndex(io, "hdata/index.json");
		expect(await idx.list()).toEqual([]);
	});
});

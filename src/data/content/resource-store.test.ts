import { describe, expect, it } from "vitest";
import { NotInstalledError, SchemaError } from "../schema";
import { makeFakeIO } from "../testing";
import { ResourceStore } from "./resource-store";

describe("ResourceStore", () => {
	it("writes then loads a blob (atomic tmp→rename), and caches the parse", async () => {
		const io = makeFakeIO();
		const store = new ResourceStore(io);
		await store.write("hadith", "fawazahmed0-nawawi-eng", { hadiths: [1, 2] });
		expect(io.calls).toContain("rename:hdata/hadith/fawazahmed0-nawawi-eng.json.tmp->hdata/hadith/fawazahmed0-nawawi-eng.json");
		const a = await store.load<{ hadiths: number[] }>("hadith", "fawazahmed0-nawawi-eng");
		const readCount = io.calls.filter((c) => c.startsWith("read:")).length;
		const b = await store.load("hadith", "fawazahmed0-nawawi-eng");
		expect(a).toEqual({ hadiths: [1, 2] });
		expect(b).toBe(a); // cached reference, no re-read
		expect(io.calls.filter((c) => c.startsWith("read:"))).toHaveLength(readCount);
	});

	it("throws NotInstalledError when absent", async () => {
		const store = new ResourceStore(makeFakeIO());
		await expect(store.load("hadith", "nope")).rejects.toThrow(NotInstalledError);
	});

	it("throws SchemaError on invalid JSON", async () => {
		const io = makeFakeIO({ "hdata/hadith/bad.json": "{not json" });
		const store = new ResourceStore(io);
		await expect(store.load("hadith", "bad")).rejects.toThrow(SchemaError);
	});

	it("remove deletes the file and evicts the cache", async () => {
		const io = makeFakeIO();
		const store = new ResourceStore(io);
		await store.write("hadith", "x", { a: 1 });
		await store.load("hadith", "x");
		await store.remove("hadith", "x");
		await expect(store.load("hadith", "x")).rejects.toThrow(NotInstalledError);
	});

	it("lists installed ids under a domain", async () => {
		const io = makeFakeIO({
			"hdata/hadith/a-b-eng.json": "{}",
			"hdata/hadith/c-d-ara.json": "{}",
		});
		const store = new ResourceStore(io);
		expect((await store.list("hadith")).sort()).toEqual(["a-b-eng", "c-d-ara"]);
	});
});

import { describe, expect, it, vi } from "vitest";
import { makeFakeIO } from "../testing";
import { CatalogCache } from "./catalog-cache";

const pathFor = (k: string) => `hdata/catalog-${k}.json`;

describe("CatalogCache", () => {
	it("fetches and persists on first call", async () => {
		const io = makeFakeIO();
		const cache = new CatalogCache<number>(io, pathFor);
		const fetch = vi.fn().mockResolvedValue([1, 2, 3]);
		const r = await cache.get("fawaz", fetch);
		expect(r).toEqual({ resources: [1, 2, 3], stale: false });
		expect(fetch).toHaveBeenCalledOnce();
		expect(await io.exists("hdata/catalog-fawaz.json")).toBe(true);
	});

	it("serves cache within TTL without refetching", async () => {
		const io = makeFakeIO();
		const cache = new CatalogCache<number>(io, pathFor);
		await cache.get("fawaz", vi.fn().mockResolvedValue([1]));
		const fetch2 = vi.fn().mockResolvedValue([9]);
		const r = await cache.get("fawaz", fetch2);
		expect(r.resources).toEqual([1]);
		expect(fetch2).not.toHaveBeenCalled();
	});

	it("force refetches even within TTL", async () => {
		const io = makeFakeIO();
		const cache = new CatalogCache<number>(io, pathFor);
		await cache.get("fawaz", vi.fn().mockResolvedValue([1]));
		const r = await cache.get("fawaz", vi.fn().mockResolvedValue([2]), { force: true });
		expect(r.resources).toEqual([2]);
	});

	it("refetches once past TTL", async () => {
		const io = makeFakeIO();
		const cache = new CatalogCache<number>(io, pathFor, 10);
		await cache.get("fawaz", vi.fn().mockResolvedValue([1]));
		await new Promise((r) => setTimeout(r, 15));
		const r = await cache.get("fawaz", vi.fn().mockResolvedValue([2]));
		expect(r.resources).toEqual([2]);
	});

	it("falls back to cache when fetch fails", async () => {
		const io = makeFakeIO();
		const cache = new CatalogCache<number>(io, pathFor, 0); // always stale
		await cache.get("fawaz", vi.fn().mockResolvedValue([1]));
		const r = await cache.get("fawaz", vi.fn().mockRejectedValue(new Error("net")));
		expect(r).toEqual({ resources: [1], stale: true });
	});

	it("returns empty + stale when no cache and fetch fails", async () => {
		const io = makeFakeIO();
		const cache = new CatalogCache<number>(io, pathFor);
		const r = await cache.get("fawaz", vi.fn().mockRejectedValue(new Error("net")));
		expect(r).toEqual({ resources: [], stale: true });
	});
});

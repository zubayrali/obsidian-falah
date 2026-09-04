import { describe, expect, it, vi } from "vitest";
import {
	RecitationOfflineManager,
	createDefaultRecitationOfflineManager,
	type RecitationOfflineStore,
} from "./offline";
import { RECITERS, recitationUrl } from "./recitation";

class MemoryOfflineStore implements RecitationOfflineStore {
	readonly cached = new Set<string>();
	readonly stored: string[] = [];
	readonly removed: string[] = [];
	onStore?: (url: string) => void;

	async has(url: string): Promise<boolean> { return this.cached.has(url); }
	async store(url: string): Promise<void> {
		this.stored.push(url);
		this.cached.add(url);
		this.onStore?.(url);
	}
	async remove(url: string): Promise<void> {
		this.removed.push(url);
		this.cached.delete(url);
	}
	async list(prefix: string): Promise<string[]> {
		return [...this.cached].filter((url) => url.startsWith(prefix));
	}
}

const counts = (surah: number) => surah === 1 ? 2 : surah === 2 ? 3 : 1;

describe("RecitationOfflineManager", () => {
	it("downloads every ayah in the selected surahs and reports progress", async () => {
		const store = new MemoryOfflineStore();
		const manager = new RecitationOfflineManager(counts, store, 2);
		const progress = vi.fn();

		const result = await manager.downloadSurahs(RECITERS[0], [1, 2], progress);

		expect(result).toEqual({ completed: 5, total: 5, skipped: 0 });
		expect(store.stored).toHaveLength(5);
		expect(store.stored).toContain(recitationUrl(RECITERS[0], { surah: 2, ayah: 3 }));
		expect(progress).toHaveBeenLastCalledWith(result);
	});

	it("resumes by keeping ayahs that are already cached", async () => {
		const store = new MemoryOfflineStore();
		const cached = recitationUrl(RECITERS[0], { surah: 1, ayah: 1 });
		store.cached.add(cached);
		const manager = new RecitationOfflineManager(counts, store);

		const result = await manager.downloadSurahs(RECITERS[0], [1]);

		expect(result).toEqual({ completed: 2, total: 2, skipped: 1 });
		expect(store.stored).toEqual([recitationUrl(RECITERS[0], { surah: 1, ayah: 2 })]);
	});

	it("stops taking new jobs after cancellation and keeps completed files", async () => {
		const store = new MemoryOfflineStore();
		const controller = new AbortController();
		store.onStore = () => controller.abort();
		const manager = new RecitationOfflineManager(counts, store, 1);

		await expect(manager.downloadSurahs(RECITERS[0], [2], undefined, controller.signal))
			.rejects.toMatchObject({ name: "AbortError" });
		expect(store.stored).toHaveLength(1);
		expect(store.cached.size).toBe(1);
	});

	it("distinguishes complete and partial cached surahs", async () => {
		const store = new MemoryOfflineStore();
		store.cached.add(recitationUrl(RECITERS[0], { surah: 1, ayah: 1 }));
		store.cached.add(recitationUrl(RECITERS[0], { surah: 1, ayah: 2 }));
		store.cached.add(recitationUrl(RECITERS[0], { surah: 2, ayah: 1 }));
		const manager = new RecitationOfflineManager(counts, store);

		await expect(manager.status(RECITERS[0])).resolves.toEqual({
			cachedAyahs: 3,
			completeSurahs: [1],
			partialSurahs: [2],
		});
	});

	it("removes only the selected reciter or selected surah", async () => {
		const store = new MemoryOfflineStore();
		const firstOne = recitationUrl(RECITERS[0], { surah: 1, ayah: 1 });
		const firstTwo = recitationUrl(RECITERS[0], { surah: 2, ayah: 1 });
		const other = recitationUrl(RECITERS[1], { surah: 1, ayah: 1 });
		store.cached.add(firstOne);
		store.cached.add(firstTwo);
		store.cached.add(other);
		const manager = new RecitationOfflineManager(counts, store);

		await expect(manager.removeSurahs(RECITERS[0], [1])).resolves.toBe(1);
		expect(store.cached).toEqual(new Set([firstTwo, other]));
		await expect(manager.removeReciter(RECITERS[0])).resolves.toBe(1);
		expect(store.cached).toEqual(new Set([other]));
	});

	it("reports unsupported Cache Storage without constructing a broken manager", () => {
		expect(createDefaultRecitationOfflineManager(counts, null)).toBeUndefined();
	});
});

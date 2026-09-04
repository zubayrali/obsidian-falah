import {
	RECITATION_CACHE_NAME,
	recitationUrl,
	type AudioRef,
	type Reciter,
} from "./recitation";

export interface RecitationOfflineStore {
	has(url: string): Promise<boolean>;
	store(url: string, signal?: AbortSignal): Promise<void>;
	remove(url: string): Promise<void>;
	list(prefix: string): Promise<string[]>;
}

export interface RecitationDownloadProgress {
	completed: number;
	total: number;
	skipped: number;
}

export interface RecitationOfflineStatus {
	cachedAyahs: number;
	completeSurahs: number[];
	partialSurahs: number[];
}

function abortError(): DOMException {
	return new DOMException("Recitation download was cancelled.", "AbortError");
}

function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

function parseAudioRef(url: string): AudioRef | undefined {
	const match = /\/(\d{3})(\d{3})\.mp3(?:$|[?#])/.exec(url);
	if (!match) return undefined;
	const surah = Number(match[1]);
	const ayah = Number(match[2]);
	return surah >= 1 && surah <= 114 && ayah >= 1 ? { surah, ayah } : undefined;
}

/** Raw Cache Storage access shared with cache-first playback. */
export class CacheStorageRecitationOfflineStore implements RecitationOfflineStore {
	constructor(
		private readonly cacheStorage: CacheStorage,
		private readonly cacheName = RECITATION_CACHE_NAME,
	) {}

	private async cache(): Promise<Cache> {
		return this.cacheStorage.open(this.cacheName);
	}

	async has(url: string): Promise<boolean> {
		return Boolean(await (await this.cache()).match(url));
	}

	async store(url: string, signal?: AbortSignal): Promise<void> {
		assertNotAborted(signal);
		const response = await window.fetch(url, { signal });
		if (!response.ok) throw new Error(`Couldn't download recitation audio (HTTP ${response.status}).`);
		assertNotAborted(signal);
		await (await this.cache()).put(url, response);
	}

	async remove(url: string): Promise<void> {
		await (await this.cache()).delete(url);
	}

	async list(prefix: string): Promise<string[]> {
		const keys = await (await this.cache()).keys();
		return keys.map((request) => request.url).filter((url) => url.startsWith(prefix));
	}
}

export class RecitationOfflineManager {
	constructor(
		private readonly ayahCount: (surah: number) => number,
		private readonly store: RecitationOfflineStore,
		private readonly concurrency = 3,
	) {
		if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("Concurrency must be at least one.");
	}

	async downloadSurahs(
		reciter: Reciter,
		surahs: number[],
		onProgress: (progress: RecitationDownloadProgress) => void = () => undefined,
		signal?: AbortSignal,
	): Promise<RecitationDownloadProgress> {
		const uniqueSurahs = [...new Set(surahs)];
		const urls: string[] = [];
		for (const surah of uniqueSurahs) {
			if (!Number.isInteger(surah) || surah < 1 || surah > 114) throw new RangeError("Surah must be between 1 and 114.");
			const count = this.ayahCount(surah);
			if (!Number.isInteger(count) || count < 1) throw new RangeError(`No ayah count is available for surah ${surah}.`);
			for (let ayah = 1; ayah <= count; ayah++) urls.push(recitationUrl(reciter, { surah, ayah }));
		}

		const progress: RecitationDownloadProgress = { completed: 0, total: urls.length, skipped: 0 };
		onProgress({ ...progress });
		let cursor = 0;
		const worker = async (): Promise<void> => {
			while (cursor < urls.length) {
				assertNotAborted(signal);
				const url = urls[cursor++];
				if (await this.store.has(url)) progress.skipped += 1;
				else await this.store.store(url, signal);
				progress.completed += 1;
				onProgress({ ...progress });
			}
		};
		await Promise.all(Array.from({ length: Math.min(this.concurrency, urls.length) }, () => worker()));
		return { ...progress };
	}

	async status(reciter: Reciter): Promise<RecitationOfflineStatus> {
		const urls = await this.store.list(`${reciter.baseUrl}/`);
		const cached = new Map<number, Set<number>>();
		for (const url of urls) {
			const ref = parseAudioRef(url);
			if (!ref || ref.ayah > this.ayahCount(ref.surah)) continue;
			const ayahs = cached.get(ref.surah) ?? new Set<number>();
			ayahs.add(ref.ayah);
			cached.set(ref.surah, ayahs);
		}
		const completeSurahs: number[] = [];
		const partialSurahs: number[] = [];
		for (const [surah, ayahs] of cached) {
			if (ayahs.size === this.ayahCount(surah)) completeSurahs.push(surah);
			else partialSurahs.push(surah);
		}
		completeSurahs.sort((a, b) => a - b);
		partialSurahs.sort((a, b) => a - b);
		return {
			cachedAyahs: [...cached.values()].reduce((total, ayahs) => total + ayahs.size, 0),
			completeSurahs,
			partialSurahs,
		};
	}

	async removeReciter(reciter: Reciter): Promise<number> {
		const urls = await this.store.list(`${reciter.baseUrl}/`);
		await Promise.all(urls.map((url) => this.store.remove(url)));
		return urls.length;
	}

	async removeSurahs(reciter: Reciter, surahs: number[]): Promise<number> {
		const selected = new Set(surahs);
		const urls = (await this.store.list(`${reciter.baseUrl}/`)).filter((url) => {
			const ref = parseAudioRef(url);
			return ref ? selected.has(ref.surah) : false;
		});
		await Promise.all(urls.map((url) => this.store.remove(url)));
		return urls.length;
	}
}

export function createDefaultRecitationOfflineManager(
	ayahCount: (surah: number) => number,
	cacheStorage: CacheStorage | null = typeof caches === "undefined" ? null : caches,
): RecitationOfflineManager | undefined {
	return cacheStorage
		? new RecitationOfflineManager(ayahCount, new CacheStorageRecitationOfflineStore(cacheStorage))
		: undefined;
}

import { parseAyahKey } from "../ref";
import { NotInstalledError } from "./schema";
import type { DataStore } from "./store";
import type { Registry } from "./registry";
import { parseWordByWord, type WordByWordVerse } from "../word-by-word/model";
import type { WordByWordDataAccess, WordByWordResource } from "../word-by-word/data-access";

/** Local adapter for imported/downloaded resources whose cardinality is per-word. */
export class LocalWordByWordData implements WordByWordDataAccess {
	private cache = new Map<string, WordByWordVerse[]>();
	constructor(private store: DataStore, private registry: Registry) {}

	async listResources(): Promise<readonly WordByWordResource[]> {
		return (await this.registry.listResources())
			.filter((descriptor) => descriptor.cardinality === "per-word")
			.map((descriptor) => ({ descriptor, installed: true }));
	}

	async installResource(resourceId: string): Promise<void> {
		throw new NotInstalledError(resourceId, "Install this per-word pack from Falah's Library or imports folder first.");
	}

	async readVerse(resourceId: string, ayahKey: string): Promise<WordByWordVerse | undefined> {
		const ref = parseAyahKey(ayahKey);
		if (!ref) return undefined;
		const cacheKey = `${resourceId}:${ref.surah}`;
		let verses = this.cache.get(cacheKey);
		if (!verses) {
			const raw = await this.store.loadSurahFile<unknown>("translations", resourceId, ref.surah);
			verses = parseWordByWord(raw);
			this.cache.set(cacheKey, verses);
		}
		return verses.find((verse) => verse.ayahKey === ayahKey);
	}
}

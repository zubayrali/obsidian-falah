// On-disk layout for downloaded/imported resources + lazy loader + LRU + pack
// ingestion + index-rebuild scan (spec §5.2, §6). The bundled core never touches
// this module (spec §3) — it is loaded by core.ts from main.js.

import { NotInstalledError, SchemaError } from "./schema";
import type { ResourceDescriptor, ResourceType, TranslationVerse } from "./schema";

export const LRU_CAPACITY = 24;

export type ResourceCategory = "quran" | "translations" | "tafsirs";

export function categoryForType(type: ResourceType): ResourceCategory {
	if (type === "quran-script") return "quran";
	if (type === "tafsir") return "tafsirs";
	return "translations"; // "translation" and (future) "recitation"; recitation never persisted in A
}

/** Implemented by Obsidian's DataAdapter in main.ts; by an in-memory Map in tests.
 *  `list(path)` returns names *relative to* `path` (not full paths) — Obsidian's
 *  DataAdapter.list returns vault-relative paths, so the FileIO adapter built in
 *  Task 9 strips the queried prefix before returning. `mkdir` creates intermediate
 *  directories recursively, matching DataAdapter.mkdir. */
export interface FileIO {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	remove(path: string): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

/** Minimal in-memory LRU cache of parsed per-surah files, keyed by relative path. */
class Lru<T> {
	private map = new Map<string, T>();
	constructor(private capacity: number) {}

	get(key: string): T | undefined {
		const v = this.map.get(key);
		if (v === undefined) return undefined;
		this.map.delete(key);
		this.map.set(key, v); // refresh recency
		return v;
	}

	set(key: string, value: T): void {
		this.map.delete(key);
		this.map.set(key, value);
		if (this.map.size > this.capacity) {
			const oldest = this.map.keys().next().value as string;
			this.map.delete(oldest);
		}
	}

	deletePrefix(prefix: string): void {
		for (const key of [...this.map.keys()]) {
			if (key.startsWith(prefix)) this.map.delete(key);
		}
	}
}

export class DataStore {
	private lru = new Lru<unknown>(LRU_CAPACITY);

	constructor(private io: FileIO, private root = "qdata") {}

	private surahPath(category: ResourceCategory, resourceId: string, surah: number): string {
		return `${this.root}/${category}/${resourceId}/${String(surah).padStart(3, "0")}.json`;
	}

	async loadSurahFile<T>(category: ResourceCategory, resourceId: string, surah: number): Promise<T> {
		const path = this.surahPath(category, resourceId, surah);
		const cached = this.lru.get(path);
		if (cached !== undefined) return cached as T;
		if (!(await this.io.exists(path))) {
			throw new NotInstalledError(resourceId, `${resourceId} surah ${surah} not installed`);
		}
		const raw = await this.io.read(path);
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new SchemaError(`${path}: invalid JSON`);
		}
		if (!Array.isArray(parsed)) {
			throw new SchemaError(`${path}: expected an array`);
		}
		this.lru.set(path, parsed);
		return parsed as T;
	}

	async writeSurahFile(
		category: ResourceCategory,
		resourceId: string,
		surah: number,
		data: unknown
	): Promise<void> {
		const path = this.surahPath(category, resourceId, surah);
		const dir = `${this.root}/${category}/${resourceId}`;
		if (!(await this.io.exists(dir))) await this.io.mkdir(dir);
		const tmp = `${path}.tmp`;
		await this.io.write(tmp, JSON.stringify(data));
		await this.io.rename(tmp, path);
		this.lru.set(path, data);
	}

	async removeResource(category: ResourceCategory, resourceId: string): Promise<void> {
		const dir = `${this.root}/${category}/${resourceId}`;
		// Evict cached surah files first: loadSurahFile serves the LRU before the
		// exists() check, so without this a removed resource keeps rendering from
		// memory until reload.
		this.lru.deletePrefix(`${dir}/`);
		if (await this.io.exists(dir)) await this.io.remove(dir);
	}

	async ingestPack(
		category: ResourceCategory,
		pack: { descriptor: ResourceDescriptor; bySurah: Map<number, TranslationVerse[]> }
	): Promise<{ descriptor: ResourceDescriptor; surahs: number[] }> {
		const surahs: number[] = [];
		for (const [surah, verses] of pack.bySurah) {
			await this.writeSurahFile(category, pack.descriptor.id, surah, verses);
			surahs.push(surah);
		}
		surahs.sort((a, b) => a - b);
		return { descriptor: pack.descriptor, surahs };
	}

	/** Raw directory scan for index-rebuild (spec §6, §11): directories under a
	 *  category → resource ids, files inside → installed surah numbers. No metadata
	 *  interpretation here — that's registry.ts's job, rehydrating from cached
	 *  catalogs when available. */
	async scanQdata(): Promise<Record<ResourceCategory, Record<string, number[]>>> {
		const categories: ResourceCategory[] = ["quran", "translations", "tafsirs"];
		const result: Record<ResourceCategory, Record<string, number[]>> = {
			quran: {},
			translations: {},
			tafsirs: {},
		};
		for (const category of categories) {
			const catPath = `${this.root}/${category}`;
			if (!(await this.io.exists(catPath))) continue;
			const { folders } = await this.io.list(catPath);
			for (const resourceId of folders) {
				const { files } = await this.io.list(`${catPath}/${resourceId}`);
				result[category][resourceId] = files
					.filter((f) => /^\d{3}\.json$/.test(f))
					.map((f) => parseInt(f.slice(0, 3), 10))
					.sort((a, b) => a - b);
			}
		}
		return result;
	}

	/** Clean up orphaned *.tmp files left by a crash mid-write (spec §11). */
	async cleanupOrphanedTmp(): Promise<void> {
		const categories: ResourceCategory[] = ["quran", "translations", "tafsirs"];
		for (const category of categories) {
			const catPath = `${this.root}/${category}`;
			if (!(await this.io.exists(catPath))) continue;
			const { folders } = await this.io.list(catPath);
			for (const resourceId of folders) {
				const dir = `${catPath}/${resourceId}`;
				const { files } = await this.io.list(dir);
				for (const f of files) {
					if (f.endsWith(".tmp")) await this.io.remove(`${dir}/${f}`);
				}
			}
		}
	}
}

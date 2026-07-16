// Generic, domain-blind blob store: one JSON file per resource under
// {root}/{domain}/{id}.json. Atomic tmp→rename writes; parsed-value LRU. The
// hadith domain is the first consumer; future content types reuse it unchanged.
// Deliberately independent of the Quran-specific DataStore (per-surah, different
// shape) so neither constrains the other.

import { NotInstalledError, SchemaError } from "../schema";
import type { FileIO } from "../store";

const LRU_CAPACITY = 24;

class Lru<T> {
	private map = new Map<string, T>();
	constructor(private capacity: number) {}
	get(key: string): T | undefined {
		const v = this.map.get(key);
		if (v === undefined) return undefined;
		this.map.delete(key);
		this.map.set(key, v);
		return v;
	}
	set(key: string, value: T): void {
		this.map.delete(key);
		this.map.set(key, value);
		if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value as string);
	}
	delete(key: string): void {
		this.map.delete(key);
	}
}

export class ResourceStore {
	private lru = new Lru<unknown>(LRU_CAPACITY);

	constructor(private io: FileIO, private root = "hdata") {}

	private path(domain: string, id: string): string {
		return `${this.root}/${domain}/${id}.json`;
	}

	async load<T>(domain: string, id: string): Promise<T> {
		const path = this.path(domain, id);
		const cached = this.lru.get(path);
		if (cached !== undefined) return cached as T;
		if (!(await this.io.exists(path))) {
			throw new NotInstalledError(id, `${id} not installed`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(await this.io.read(path));
		} catch {
			throw new SchemaError(`${path}: invalid JSON`);
		}
		this.lru.set(path, parsed);
		return parsed as T;
	}

	async write(domain: string, id: string, data: unknown): Promise<void> {
		const dir = `${this.root}/${domain}`;
		if (!(await this.io.exists(dir))) await this.io.mkdir(dir);
		const path = this.path(domain, id);
		const tmp = `${path}.tmp`;
		await this.io.write(tmp, JSON.stringify(data));
		await this.io.rename(tmp, path);
		this.lru.set(path, data);
	}

	async remove(domain: string, id: string): Promise<void> {
		const path = this.path(domain, id);
		this.lru.delete(path);
		if (await this.io.exists(path)) await this.io.remove(path);
	}

	async list(domain: string): Promise<string[]> {
		const dir = `${this.root}/${domain}`;
		if (!(await this.io.exists(dir))) return [];
		const { files } = await this.io.list(dir);
		return files.filter((f) => f.endsWith(".json") && !f.endsWith(".tmp")).map((f) => f.slice(0, -5));
	}
}

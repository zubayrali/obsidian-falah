// Generic installed-resource index for the content layer. One JSON file listing
// what's installed, atomic writes, shape-guarded reads (corrupt → empty, so a
// bad file never blocks the reader — the user just re-downloads). Domain-blind:
// no per-surah shape, a `count` instead. Mirrors Registry's write discipline
// without coupling to the Quran registry.

import type { ResourceTier } from "../schema";
import type { FileIO } from "../store";

export interface InstallEntry {
	id: string;
	type: string;
	name: string;
	language: string;
	tier: ResourceTier;
	provenance?: string;
	version?: string;
	sizeBytes?: number;
	count?: number;
	installedAt: number;
	meta?: Record<string, unknown>;
}

interface IndexFile {
	version: number;
	resources: Record<string, InstallEntry>;
}

const INDEX_VERSION = 1;

export class InstallIndex {
	constructor(private io: FileIO, private indexPath: string) {}

	private async read(): Promise<IndexFile> {
		if (!(await this.io.exists(this.indexPath))) return { version: INDEX_VERSION, resources: {} };
		try {
			const parsed = JSON.parse(await this.io.read(this.indexPath)) as IndexFile;
			if (typeof parsed.version !== "number" || typeof parsed.resources !== "object" || parsed.resources === null) {
				throw new Error("bad shape");
			}
			return parsed;
		} catch {
			return { version: INDEX_VERSION, resources: {} };
		}
	}

	private async write(index: IndexFile): Promise<void> {
		const slash = this.indexPath.lastIndexOf("/");
		if (slash > 0) {
			const dir = this.indexPath.slice(0, slash);
			if (!(await this.io.exists(dir))) await this.io.mkdir(dir);
		}
		const tmp = `${this.indexPath}.tmp`;
		await this.io.write(tmp, JSON.stringify(index));
		await this.io.rename(tmp, this.indexPath);
	}

	async list(): Promise<InstallEntry[]> {
		return Object.values((await this.read()).resources);
	}

	async get(id: string): Promise<InstallEntry | undefined> {
		return (await this.read()).resources[id];
	}

	async put(entry: InstallEntry): Promise<void> {
		const index = await this.read();
		index.resources[entry.id] = entry;
		await this.write(index);
	}

	async remove(id: string): Promise<void> {
		const index = await this.read();
		delete index.resources[id];
		await this.write(index);
	}
}

// Installed-resource index + per-source catalog cache + bundled-core merge
// (spec §5.3, §6). The registry is the only writer of index.json.

import type { CoreLoader } from "./core";
import type {
	DownloadSourceId,
	ResourceDescriptor,
	ResourceTier,
	ResourceType,
} from "./schema";
import type { DataStore, FileIO, ResourceCategory } from "./store";

export const INDEX_PATH = "qdata/index.json"; // registry-owned, atomic writes (§6)
export const INDEX_VERSION = 1;
const CATALOG_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (spec §5.3)

export interface InstalledResourceEntry {
	type: ResourceType;
	name: string;
	language: string;
	tier: ResourceTier;
	source?: DownloadSourceId;
	sourceResourceId?: string;
	version?: string;
	license?: string;
	installedAt: number;
	surahs: number[];
}

interface IndexFile {
	version: number;
	resources: Record<string, InstalledResourceEntry>;
}

interface CatalogCacheFile {
	fetchedAt: number;
	resources: ResourceDescriptor[];
}

const CATEGORY_TO_TYPE: Record<ResourceCategory, ResourceType> = {
	quran: "quran-script",
	translations: "translation",
	tafsirs: "tafsir",
};

export class Registry {
	constructor(
		private io: FileIO,
		private store: DataStore,
		public readonly core: CoreLoader,
		private root = "qdata"
	) {}

	private indexPath(): string {
		return `${this.root}/index.json`;
	}

	// Keyed by source AND type: a single source (e.g. QUL) serves both translations
	// and tafsirs, so a source-only key would let one type's fetch overwrite the
	// other's cache (Fix E).
	private catalogPath(source: DownloadSourceId, type: ResourceType): string {
		return `${this.root}/catalog-${source}-${type}.json`;
	}

	private async ensureRoot(): Promise<void> {
		if (!(await this.io.exists(this.root))) await this.io.mkdir(this.root);
	}

	private async readIndex(): Promise<IndexFile> {
		if (!(await this.io.exists(this.indexPath()))) return this.rebuildIndex();
		try {
			const parsed = JSON.parse(await this.io.read(this.indexPath())) as IndexFile;
			if (typeof parsed.version !== "number" || typeof parsed.resources !== "object") {
				throw new Error("bad shape");
			}
			return parsed;
		} catch {
			return this.rebuildIndex();
		}
	}

	private async writeIndex(index: IndexFile): Promise<void> {
		await this.ensureRoot();
		const tmp = `${this.indexPath()}.tmp`;
		await this.io.write(tmp, JSON.stringify(index));
		await this.io.rename(tmp, this.indexPath());
	}

	/** Conservative rebuild by scanning qdata/ when index.json is missing or corrupt
	 *  (spec §6, §11). Metadata beyond type/name/surahs isn't recoverable from a bare
	 *  directory scan; name falls back to the resource id itself. */
	private async rebuildIndex(): Promise<IndexFile> {
		const scan = await this.store.scanQdata();
		const resources: Record<string, InstalledResourceEntry> = {};
		for (const category of Object.keys(scan) as ResourceCategory[]) {
			for (const [resourceId, surahs] of Object.entries(scan[category])) {
				resources[resourceId] = {
					type: CATEGORY_TO_TYPE[category],
					name: resourceId,
					language: "en",
					tier: "downloaded",
					installedAt: Date.now(),
					surahs,
				};
			}
		}
		const index: IndexFile = { version: INDEX_VERSION, resources };
		await this.writeIndex(index);
		return index;
	}

	async listInstalled(): Promise<ResourceDescriptor[]> {
		const index = await this.readIndex();
		return Object.entries(index.resources).map(([id, e]) => ({
			id,
			type: e.type,
			name: e.name,
			language: e.language,
			tier: e.tier,
			source: e.source,
			sourceResourceId: e.sourceResourceId,
			version: e.version,
			license: e.license,
		}));
	}

	/** Installed + bundled-core descriptors merged uniformly (§5.3). */
	async listResources(): Promise<ResourceDescriptor[]> {
		return [...this.core.listDescriptors(), ...(await this.listInstalled())];
	}

	async isSurahInstalled(resourceId: string, surah: number): Promise<boolean> {
		const index = await this.readIndex();
		return index.resources[resourceId]?.surahs.includes(surah) ?? false;
	}

	async recordSurahInstalled(desc: ResourceDescriptor, surah: number): Promise<void> {
		const index = await this.readIndex();
		const existing = index.resources[desc.id];
		const surahs = existing
			? [...new Set([...existing.surahs, surah])].sort((a, b) => a - b)
			: [surah];
		index.resources[desc.id] = {
			type: desc.type,
			name: desc.name,
			language: desc.language,
			tier: desc.tier,
			source: desc.source,
			sourceResourceId: desc.sourceResourceId,
			version: desc.version,
			license: desc.license,
			installedAt: existing?.installedAt ?? Date.now(),
			surahs,
		};
		await this.writeIndex(index);
	}

	async recordImport(desc: ResourceDescriptor, surahs: number[]): Promise<void> {
		const index = await this.readIndex();
		index.resources[desc.id] = {
			type: desc.type,
			name: desc.name,
			language: desc.language,
			tier: "user-import",
			license: desc.license,
			installedAt: Date.now(),
			surahs: [...surahs].sort((a, b) => a - b),
		};
		await this.writeIndex(index);
	}

	async removeResource(resourceId: string, category: ResourceCategory): Promise<void> {
		const index = await this.readIndex();
		delete index.resources[resourceId];
		await this.writeIndex(index);
		await this.store.removeResource(category, resourceId);
	}

	async getCatalog(
		source: DownloadSourceId,
		type: ResourceType,
		fetchCatalog: () => Promise<ResourceDescriptor[]>,
		opts?: { force?: boolean }
	): Promise<{ resources: ResourceDescriptor[]; stale: boolean }> {
		const path = this.catalogPath(source, type);
		let cached: CatalogCacheFile | undefined;
		if (await this.io.exists(path)) {
			try {
				const parsed = JSON.parse(await this.io.read(path)) as CatalogCacheFile;
				// Shape guard (mirrors readIndex): a syntactically-valid but wrong-shaped
				// cache would otherwise yield NaN staleness / undefined resources and
				// break the ResourceDescriptor[] contract. Treat it as no usable cache.
				if (typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.resources)) {
					throw new Error("bad shape");
				}
				cached = parsed;
			} catch {
				cached = undefined;
			}
		}
		const stale = Boolean(opts?.force) || !cached || Date.now() - cached.fetchedAt > CATALOG_STALE_MS;
		if (!stale && cached) return { resources: cached.resources, stale: false };
		try {
			const fresh = await fetchCatalog();
			const file: CatalogCacheFile = { fetchedAt: Date.now(), resources: fresh };
			await this.ensureRoot();
			const tmp = `${path}.tmp`;
			await this.io.write(tmp, JSON.stringify(file));
			await this.io.rename(tmp, path);
			return { resources: fresh, stale: false };
		} catch {
			// catalog fetch failure is non-fatal (spec §5.3): fall back to any cache
			return { resources: cached?.resources ?? [], stale: true };
		}
	}

	/** Version-mismatch flag: a catalog entry's version differs from the installed
	 *  entry's (spec §5.3). Never blocks reads of existing data. */
	async updatesAvailable(catalog: ResourceDescriptor[]): Promise<string[]> {
		const index = await this.readIndex();
		const out: string[] = [];
		for (const c of catalog) {
			const installed = index.resources[c.id];
			if (installed && c.version && installed.version && c.version !== installed.version) {
				out.push(c.id);
			}
		}
		return out;
	}
}

// Generic staleness cache for source catalogs — the exact discipline in
// Registry.getCatalog, extracted and made generic over the cached element type
// so any domain (hadith now; more later) can cache its own catalog entries.
// Fetch failure is non-fatal: falls back to whatever cache exists.

import type { FileIO } from "../store";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (matches Registry)

interface CacheFile<T> {
	fetchedAt: number;
	resources: T[];
}

export class CatalogCache<T> {
	constructor(
		private io: FileIO,
		private pathFor: (key: string) => string,
		private ttlMs = DEFAULT_TTL_MS
	) {}

	async get(
		key: string,
		fetch: () => Promise<T[]>,
		opts?: { force?: boolean }
	): Promise<{ resources: T[]; stale: boolean }> {
		const path = this.pathFor(key);
		let cached: CacheFile<T> | undefined;
		if (await this.io.exists(path)) {
			try {
				const parsed = JSON.parse(await this.io.read(path)) as CacheFile<T>;
				if (typeof parsed.fetchedAt === "number" && Array.isArray(parsed.resources)) cached = parsed;
			} catch {
				cached = undefined;
			}
		}
		const stale = Boolean(opts?.force) || !cached || Date.now() - cached.fetchedAt >= this.ttlMs;
		if (!stale && cached) return { resources: cached.resources, stale: false };
		try {
			const fresh = await fetch();
			const tmp = `${path}.tmp`;
			// Lazy parent-dir guard: a catalog fetch can precede any store write in
			// some call orders, so the parent dir isn't guaranteed to exist yet.
			const slash = path.lastIndexOf("/");
			if (slash > 0 && !(await this.io.exists(path.slice(0, slash)))) await this.io.mkdir(path.slice(0, slash));
			await this.io.write(tmp, JSON.stringify({ fetchedAt: Date.now(), resources: fresh } satisfies CacheFile<T>));
			await this.io.rename(tmp, path);
			return { resources: fresh, stale: false };
		} catch {
			return { resources: cached?.resources ?? [], stale: true };
		}
	}
}

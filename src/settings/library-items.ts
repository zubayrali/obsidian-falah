import type { ResourceDescriptor } from "../data/schema";
import type { HadithCatalogEntry, HadithCollectionDescriptor } from "../data/hadith/schema";

/** Installed-only resources stay manageable when a remote catalog is unavailable. */
export function mergeQuranResources(catalog: ResourceDescriptor[], installed: ResourceDescriptor[]): ResourceDescriptor[] {
	const entries = new Map(installed.filter((item) => item.tier !== "bundled" && item.cardinality !== "per-word" && (item.type === "translation" || item.type === "tafsir")).map((item) => [item.id, item]));
	for (const item of catalog) entries.set(item.id, item);
	const installedIds = new Set(installed.map((item) => item.id));
	return [...entries.values()].sort((a, b) => Number(installedIds.has(b.id)) - Number(installedIds.has(a.id)) || a.name.localeCompare(b.name));
}

export function mergeHadithCollections(catalog: HadithCatalogEntry[], installed: HadithCollectionDescriptor[]): HadithCatalogEntry[] {
	const key = (item: { source: string; collection: string }) => `${item.source}:${item.collection}`;
	const entries = new Map(catalog.map((item) => [key(item), { ...item, languages: [...item.languages] }]));
	for (const item of installed) {
		const existing = entries.get(key(item));
		if (existing) {
			if (!existing.languages.includes(item.language)) existing.languages.push(item.language);
		} else entries.set(key(item), { source: item.source, collection: item.collection, name: item.name, languages: [item.language] });
	}
	const installedKeys = new Set(installed.map(key));
	return [...entries.values()].sort((a, b) => Number(installedKeys.has(key(b))) - Number(installedKeys.has(key(a))) || a.name.localeCompare(b.name));
}

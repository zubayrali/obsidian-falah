// Pure bookmark model, id derivation, and JSON serialization. No "obsidian"
// import so vitest can run it directly. Identity is the falah:// anchor; a lens
// is an optional soft pointer to a specific view.

export interface Lens {
	kind: "tafsir" | "translation";
	editionId: string;
	lang?: string;
}
export interface Bookmark {
	id: string;
	anchor: string;
	lens?: Lens;
	note?: string;
	added: number;
	favourite?: boolean;
}
export interface BookmarkGroup {
	id: string;
	name: string;
	order: number;
	collapsed?: boolean;
	items: Bookmark[];
}
export interface RecentEntry {
	anchor: string;
	at: number;
}
export interface BookmarkStore {
	version: number;
	groups: BookmarkGroup[];
	recent?: RecentEntry[];
}

export const BOOKMARKS_VERSION = 2;

/** "" for no lens, else "tafsir:ar.ibnkathir" — stable, edition-level. */
export function lensKey(lens?: Lens): string {
	return lens ? `${lens.kind}:${lens.editionId}` : "";
}

/** Anchor identity for a plain bookmark; anchor + "#" + lensKey when lensed. */
export function bookmarkId(anchor: string, lens?: Lens): string {
	const k = lensKey(lens);
	return k ? `${anchor}#${k}` : anchor;
}

export function emptyStore(): BookmarkStore {
	return { version: BOOKMARKS_VERSION, groups: [] };
}

export function serializeStore(store: BookmarkStore): string {
	return JSON.stringify(store, null, 2);
}

/** Never throws: any malformed input degrades to an empty store. */
export function parseStore(json: string): BookmarkStore {
	try {
		const raw = JSON.parse(json) as unknown;
		if (!raw || typeof raw !== "object") return emptyStore();
		const groups = (raw as { groups?: unknown }).groups;
		if (!Array.isArray(groups)) return emptyStore();
		const recentRaw = (raw as { recent?: unknown }).recent;
		const result: BookmarkStore = {
			version: typeof (raw as { version?: unknown }).version === "number"
				? (raw as { version: number }).version
				: BOOKMARKS_VERSION,
			groups: groups.filter(isGroup),
		};
		if (Array.isArray(recentRaw)) {
			result.recent = recentRaw.filter(isRecent);
		}
		return result;
	} catch {
		return emptyStore();
	}
}

function isGroup(g: unknown): g is BookmarkGroup {
	if (!g || typeof g !== "object") return false;
	const x = g as Record<string, unknown>;
	return typeof x.id === "string" && typeof x.name === "string"
		&& typeof x.order === "number" && Array.isArray(x.items);
}

function isRecent(r: unknown): r is RecentEntry {
	if (!r || typeof r !== "object") return false;
	const x = r as Record<string, unknown>;
	return typeof x.anchor === "string" && typeof x.at === "number";
}

export function findBookmark(
	store: BookmarkStore,
	id: string,
): { group: BookmarkGroup; item: Bookmark } | null {
	for (const group of store.groups) {
		const item = group.items.find((i) => i.id === id);
		if (item) return { group, item };
	}
	return null;
}

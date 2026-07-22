// Pure bookmark ordering for the view. No "obsidian" import.
import { parseRefUri } from "../ref";
import type { Bookmark } from "./schema";

export type BookmarkSort = "added" | "manual" | "surah";

/** Returns a new array. "manual" preserves stored order. */
export function sortBookmarks(items: Bookmark[], mode: BookmarkSort): Bookmark[] {
	const out = [...items];
	if (mode === "added") out.sort((a, b) => b.added - a.added);
	else if (mode === "surah") out.sort((a, b) => surahKey(a) - surahKey(b));
	return out;
}

/** Sortable numeric key: quran surah*1000+ayah; hadith/unparseable sort last, stably. */
function surahKey(item: Bookmark): number {
	const ref = parseRefUri(item.anchor);
	if (ref?.kind === "quran") return ref.surah * 1000 + ref.ayah;
	return Number.MAX_SAFE_INTEGER;
}

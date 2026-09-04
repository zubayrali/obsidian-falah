import type { QuranDataSource } from "../data/source";
import type { ArabicScript } from "../data/schema";
import { documentsFromAyahs, documentsFromTafsirs, documentsFromTranslations, editionFromResource, OfflineQuranSearchIndex } from "./index";
import type { BuildProgress, SearchEdition } from "./types";

export interface LoadSearchOptions {
	scripts?: ArabicScript[];
	signal?: AbortSignal;
	onProgress?: (progress: BuildProgress) => void;
}

const scriptEdition = (script: ArabicScript): SearchEdition => ({
	id: `core-${script}`,
	name: script === "uthmani" ? "Quran — Uthmani" : script === "indopak" ? "Quran — IndoPak" : String(script),
	type: "quran-script",
	language: "ar",
});

/** Build an index strictly from the local QuranDataSource; this never invokes a cloud fallback. */
export async function loadOfflineSearchIndex(source: QuranDataSource, options: LoadSearchOptions = {}): Promise<OfflineQuranSearchIndex> {
	const index = new OfflineQuranSearchIndex();
	const scripts = options.scripts ?? ["uthmani", "indopak"];
	const resources = (await source.listResources()).filter((r) => r.type === "translation" || r.type === "tafsir");
	const total = 114 * (scripts.length + resources.length);
	let indexed = 0;

	for (let surah = 1; surah <= 114; surah++) {
		if (options.signal?.aborted) throw new DOMException("Search indexing cancelled", "AbortError");
		const meta = await source.getSurah(surah);
		const from = `${surah}:1`;
		const to = `${surah}:${meta.ayahCount}`;
		for (const script of scripts) {
			const ayahs = await source.getRange(from, to, script);
			index.addAll(documentsFromAyahs(scriptEdition(script), ayahs));
			options.onProgress?.({ indexed: ++indexed, total });
		}
		for (const resource of resources) {
			const edition = editionFromResource(resource);
			if (!edition) continue;
			try {
				if (resource.type === "translation") {
					const verses = await source.getTranslation(resource.id, from, to);
					index.addAll(documentsFromTranslations(edition, verses));
				} else {
					const verses = await source.getTafsir(resource.id, from, to);
					index.addAll(documentsFromTafsirs(edition, verses));
				}
			} catch {
				// A missing/corrupt optional resource is omitted; other installed editions remain searchable.
			}
			options.onProgress?.({ indexed: ++indexed, total });
		}
		await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
	}
	return index;
}

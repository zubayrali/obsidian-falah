import type { DownloadSource, FetchJson } from "./download";
import { NetworkError, SchemaError } from "./schema";
import type { ResourceDescriptor, ResourceType, TranslationVerse } from "./schema";

const BASE = "https://quranapi.pages.dev/api";
const LANGUAGES = { en: "english", bn: "bengali", ur: "urdu" } as const;

/** Static Quran.com-derived chapter files; array positions are canonical verse numbers. */
export class QuranProjectSource implements DownloadSource {
	readonly id = "quran-project" as const;
	async listCatalog(type: ResourceType): Promise<ResourceDescriptor[]> {
		if (type !== "translation") return [];
		return Object.keys(LANGUAGES).map((language) => ({
			id: `quran-project-${language}`, source: this.id, sourceResourceId: language,
			type: "translation", tier: "downloaded", language,
			name: `Quran Project (${LANGUAGES[language as keyof typeof LANGUAGES]})`,
			provenance: { provenance: "The Quran Project; Quran.com-derived data" },
		}));
	}
	async fetchSurah(desc: ResourceDescriptor, surah: number, ayahCount: number, fetchJson: FetchJson): Promise<TranslationVerse[]> {
		const language = desc.sourceResourceId as keyof typeof LANGUAGES;
		if (!Object.prototype.hasOwnProperty.call(LANGUAGES, language)) throw new SchemaError("Unsupported Quran Project language");
		let raw: unknown;
		try { raw = await fetchJson(`${BASE}/${surah}.json`); }
		catch (error) { throw new NetworkError(`Quran Project: ${error instanceof Error ? error.message : String(error)}`); }
		const body = raw as { surahNo?: unknown; totalAyah?: unknown } & Record<string, unknown>;
		const rows = body?.[LANGUAGES[language]];
		if (body?.surahNo !== surah || body.totalAyah !== ayahCount || !Array.isArray(rows) || rows.length !== ayahCount) {
			throw new SchemaError(`Quran Project chapter ${surah}: incomplete or mismatched chapter`);
		}
		return rows.map((text: unknown, i: number) => {
			if (typeof text !== "string" || !text.trim()) throw new SchemaError(`Quran Project ${surah}:${i + 1}: missing text`);
			return { ayahKey: `${surah}:${i + 1}`, text };
		});
	}
}

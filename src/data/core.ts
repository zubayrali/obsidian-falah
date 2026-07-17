// Bundled-core loader: dynamic import() of the in-main.js core JSON, per-resource,
// lazy (spec §3, §5). The core lives inside main.js — esbuild inlines each JSON
// dataset but defers evaluating it until first use, so a script the user never
// selects (e.g. Indo-Pak) is never materialized.

import type { Ayah, ResourceDescriptor, Surah, TranslationVerse } from "./schema";

export const CORE_UTHMANI_ID = "core-uthmani";
export const CORE_INDOPAK_ID = "core-indopak";
export const CORE_CLEARQURAN_ID = "core-en-clearquran";

export const BUNDLED_CORE_DESCRIPTORS: ResourceDescriptor[] = [
	{
		id: CORE_UTHMANI_ID,
		type: "quran-script",
		name: "Uthmani script",
		language: "ar",
		tier: "bundled",
		license: "Tanzil / fawazahmed0 (open)",
	},
	{
		id: CORE_INDOPAK_ID,
		type: "quran-script",
		name: "Indo-Pak script",
		language: "ar",
		tier: "bundled",
		license: "Tanzil / fawazahmed0 (open)",
	},
	{
		id: CORE_CLEARQURAN_ID,
		type: "translation",
		name: "The Clear Quran (Dr. Mustafa Khattab)",
		language: "en",
		tier: "bundled",
		license: "QUL id 131 — Dr. Mustafa Khattab, the Clear Quran (open, non-commercial)",
	},
];

type JsonModule<T> = { default: T } | T;

function unwrap<T>(mod: JsonModule<T>): T {
	return (mod as { default: T }).default ?? (mod as T);
}

/** Implemented with real dynamic import()s in `defaultCoreImportMap`;
 *  implemented with in-memory fakes in tests (spec §12). */
export interface CoreImportMap {
	uthmani: () => Promise<JsonModule<Ayah[]>>;
	indopak: () => Promise<JsonModule<Ayah[]>>;
	clearquran: () => Promise<JsonModule<TranslationVerse[]>>;
	surahs: () => Promise<JsonModule<Surah[]>>;
}

export class CoreLoader {
	private uthmani?: Promise<Ayah[]>;
	private indopak?: Promise<Ayah[]>;
	private clearquran?: Promise<TranslationVerse[]>;
	private surahs?: Promise<Surah[]>;

	constructor(private imports: CoreImportMap) {}

	getScript(script: "uthmani" | "indopak"): Promise<Ayah[]> {
		if (script === "uthmani") {
			return (this.uthmani ??= this.imports.uthmani().then(unwrap));
		}
		return (this.indopak ??= this.imports.indopak().then(unwrap));
	}

	getClearQuranTranslation(): Promise<TranslationVerse[]> {
		return (this.clearquran ??= this.imports.clearquran().then(unwrap));
	}

	getSurahs(): Promise<Surah[]> {
		return (this.surahs ??= this.imports.surahs().then(unwrap));
	}

	listDescriptors(): ResourceDescriptor[] {
		return BUNDLED_CORE_DESCRIPTORS;
	}
}

// Real wiring for main.ts (Task 9). JSON-module type inference widens literal
// unions (e.g. Surah.revelationPlace) to `string`, so an import whose schema has
// one is asserted to its true type; the rest infer structurally.
export const defaultCoreImportMap: CoreImportMap = {
	uthmani: () => import("../../assets/bundled-core/uthmani.json"),
	indopak: () => import("../../assets/bundled-core/indopak.json"),
	clearquran: () => import("../../assets/bundled-core/clearquran.json"),
	surahs: () =>
		import("../../assets/bundled-core/surahs.json") as unknown as Promise<{ default: Surah[] }>,
};

// Hadith domain schema — the normalized shape every source normalizes into.
// Isolated from the Quran schema; nothing here leaks into src/data/schema.ts.

export interface NormHadith {
	number: number; // hadith number within the collection
	arabic?: string;
	translation?: string; // absent for Arabic-only sources
	narrator?: string; // isnad, flat string
	grades?: { name: string; grade: string }[];
	chapter?: { number?: number; arabic?: string; english?: string };
	reference?: { book: number; hadith: number };
}

export interface HadithBook {
	number: number;
	arabic?: string;
	english?: string;
}

export interface HadithCollection {
	source: string; // "fawazahmed0" | "ahmedbaset" | "sunnah" | "mhashim6"
	collection: string; // "bukhari"
	language: string; // "eng" | "ara" | ...
	name: string; // English display name
	nameArabic?: string;
	books?: HadithBook[]; // section structure (Phase 2 grouping)
	hadiths: NormHadith[];
}

export interface HadithCatalogEntry {
	source: string;
	collection: string;
	name: string;
	nameArabic?: string;
	languages: string[]; // language codes this source offers for the collection
	hadithCount?: number;
}

export interface HadithCollectionDescriptor {
	id: string; // `${source}-${collection}-${language}`
	source: string;
	collection: string;
	language: string;
	name: string;
	version?: string;
	sizeBytes?: number;
	count?: number;
}

/** Filesystem-safe unique id for one installed collection-in-a-language. */
export function hadithCollectionId(source: string, collection: string, language: string): string {
	return `${source}-${collection}-${language}`;
}

// Canonical internal data model + typed errors. Pure module — no Obsidian
// imports, no I/O — mirroring the ref.ts purity pattern (spec §4).

import type { HadithRef, QuranRef } from "../ref";

/** "2:255" — canonical verse key (quran.com/QUL convention). */
export type AyahKey = string;

/** Scripts bundled in A. Open string union so any source's other script variants
 *  can be stored without a schema change. */
export type ArabicScript = "uthmani" | "indopak" | (string & {});

export interface Surah {
	number: number; // 1..114
	nameArabic: string; // "البقرة"
	nameEnglish: string; // "The Cow"
	nameTransliterated: string; // "Al-Baqarah"
	ayahCount: number;
	revelationPlace: "makkah" | "madinah";
}

export interface Ayah {
	ayahKey: AyahKey;
	surah: number;
	ayah: number;
	text: string; // in the script of the containing file (§6)
	/** Anticipated for sub-project C (word-by-word). Never populated in A. */
	words?: WordSegment[];
}

/** Anticipated shape only — no producer or consumer in A. */
export interface WordSegment {
	position: number; // 1-based word index within the ayah
	text: string;
	translation?: string;
	transliteration?: string;
}

export interface TranslationVerse {
	ayahKey: AyahKey;
	text: string; // plain text; footnote markup stripped by normalize
}

export interface TafsirVerse {
	ayahKey: AyahKey;
	/** Some tafsirs span ayah groups; the group's full key list is preserved. */
	ayahKeys?: AyahKey[];
	text: string;
}

export type ResourceType =
	| "quran-script" // an Arabic text variant (uthmani, indopak, …)
	| "translation"
	| "tafsir"
	| "recitation"; // anticipated for E; listable, not downloadable in A

export type ResourceTier = "bundled" | "downloaded" | "user-import";

/** Which adapter a downloadable resource comes from (§5.4). */
export type DownloadSourceId = "fawazahmed0" | "alquran-cloud" | "qul";

/** How a resource's content keys to the canonical text (QUL's cardinality_type).
 *  Open-ended: future types add their own without a code change. */
export type Cardinality =
	| "per-ayah"
	| "per-word"
	| "per-chapter"
	| "per-page"
	| "per-hadith"
	| (string & {});

/** Provenance for a resource (QUL's resource_content: who/where it came from). */
export interface ResourceProvenance {
	author?: string;
	edition?: string;
	provenance?: string; // e.g. "fawazahmed0", "sunnah.com"
}

/** One dataset the plugin knows about (installed or merely available). */
export interface ResourceDescriptor {
	id: string; // our stable id, source-qualified, filesystem-safe (used verbatim as a
	//   directory name, so no ":" — spec §6), e.g. "fawazahmed0-eng-sahihinternational",
	//   "alquran-cloud-en.sahih", "qul-131", "import-my-pack", "core-uthmani"
	type: ResourceType;
	name: string; // display name, e.g. "Sahih International"
	language: string; // ISO 639-1 where possible, e.g. "en"
	tier: ResourceTier;
	source?: DownloadSourceId; // present for tier "downloaded"; enables re-fetch/refresh
	sourceResourceId?: string; // the id the source itself uses (edition id / QUL numeric id / CDN slug)
	version?: string; // upstream content version, when known
	sizeBytes?: number; // approximate, for the download UI
	license?: string; // license name/short text as reported by the source
	cardinality?: Cardinality; // how content keys to text; distinct from `type`
	provenance?: ResourceProvenance; // NOT `source` (that's DownloadSourceId)
	meta?: Record<string, unknown>; // open bag: license text, direction, count, ...
}

/** What `ContentSource.getContent` returns for a Quran ref. Field-compatible
 *  superset of the old `QuranVerseDetail`, so `detail.ts` renders it unchanged. */
export interface VerseContent {
	ref: QuranRef;
	arabic: string; // range joined with spaces, in the selected script
	translation?: string; // range joined; "(n) " prefixes when multi-ayah
	translationName?: string;
	tafsir?: string;
	surahNameArabic?: string;
	surahNameEnglish?: string;
	ayahCount?: number;
	externalUrl: string; // https://quran.com/<surah>/<ayah>
}

/** Identical to the old `HadithDetail` shape (hadith stays live-API in A). */
export interface HadithContent {
	ref: HadithRef;
	arabic?: string;
	translation?: string;
	grades?: string;
	narrator?: string; // isnad, flat string; present when a source provides it
	bookName?: string;
	externalUrl: string;
}

export type ReferenceContent = VerseContent | HadithContent;

export class DataError extends Error {
	constructor(message?: string) {
		super(message);
		this.name = "DataError";
	}
}

export class NotInstalledError extends DataError {
	constructor(public resourceId: string, message?: string) {
		super(message ?? `Resource not installed: ${resourceId}`);
		this.name = "NotInstalledError";
	}
}

/** JSON failed validation on load/normalize. */
export class SchemaError extends DataError {
	constructor(message?: string) {
		super(message);
		this.name = "SchemaError";
	}
}

/** fetch failed / non-200. */
export class NetworkError extends DataError {
	constructor(message?: string) {
		super(message);
		this.name = "NetworkError";
	}
}

/** Valid resource, verse/range absent upstream. */
export class NotFoundError extends DataError {
	constructor(message?: string) {
		super(message);
		this.name = "NotFoundError";
	}
}

/** Boundary wrapper for a raw (non-`DataError`) exception — disk-full,
 *  permission-denied, and other OS-level failures that escape store/registry/
 *  download unwrapped (spec §5.1: every failure crossing the `ContentSource`
 *  seam is a typed error). `cause` is preserved for diagnostics. */
export class StorageError extends DataError {
	readonly cause?: unknown;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message);
		this.name = "StorageError";
		this.cause = options?.cause;
	}
}

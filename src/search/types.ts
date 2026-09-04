export type SearchEditionType = "quran-script" | "translation" | "tafsir";

export interface SearchEdition {
	id: string;
	name: string;
	type: SearchEditionType;
	language?: string;
}

/** A local verse-shaped record supplied by the data layer. */
export interface SearchDocumentInput {
	edition: SearchEdition;
	ayahKey: string;
	/** Grouped tafsir entries can identify every ayah covered by the text. */
	ayahKeys?: string[];
	text: string;
}

export interface SearchScope {
	editionIds?: readonly string[];
	types?: readonly SearchEditionType[];
	languages?: readonly string[];
	surahs?: readonly number[];
}

export interface SearchOptions {
	limit?: number;
	scope?: SearchScope;
	/** Maximum characters on either side of a match. */
	snippetRadius?: number;
}

export interface TextRange {
	/** Inclusive UTF-16 offset. */
	start: number;
	/** Exclusive UTF-16 offset. */
	end: number;
}

export interface SearchSnippet {
	text: string;
	/** Offsets of the snippet in the complete document text. */
	start: number;
	end: number;
	/** Match offsets relative to `text`. */
	matches: TextRange[];
}

export interface SearchHit {
	ayahKey: string;
	ayahKeys?: readonly string[];
	surah: number;
	ayah: number;
	edition: SearchEdition;
	text: string;
	snippet: SearchSnippet;
	score: number;
}

export interface BuildProgress {
	indexed: number;
	total: number;
}

export interface AsyncBuildOptions {
	batchSize?: number;
	signal?: AbortSignal;
	onProgress?: (progress: BuildProgress) => void;
	/** Injectable scheduler for browser idle yielding and deterministic tests. */
	yieldControl?: () => Promise<void>;
}

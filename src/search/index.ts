import { normalizeText, normalizedRangeToSource, tokenize } from "./normalize";
import type {
	AsyncBuildOptions,
	SearchDocumentInput,
	SearchEdition,
	SearchHit,
	SearchOptions,
	SearchScope,
	SearchSnippet,
	TextRange,
} from "./types";

export * from "./types";
export { normalizeText, tokenize } from "./normalize";
export {
	documentsFromAyahs,
	documentsFromTafsirs,
	documentsFromTranslations,
	editionFromResource,
} from "./adapters";

interface IndexedDocument extends SearchDocumentInput {
	id: number;
	normalized: ReturnType<typeof normalizeText>;
	surah: number;
	ayah: number;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_SNIPPET_RADIUS = 80;

function parseAyahKey(key: string): { surah: number; ayah: number } | undefined {
	const match = /^(\d+):(\d+)$/.exec(key);
	if (!match) return undefined;
	const surah = Number(match[1]);
	const ayah = Number(match[2]);
	if (!Number.isInteger(surah) || !Number.isInteger(ayah) || surah < 1 || surah > 114 || ayah < 1) return undefined;
	return { surah, ayah };
}

function scoped(document: IndexedDocument, scope?: SearchScope): boolean {
	if (!scope) return true;
	if (scope.editionIds && !scope.editionIds.includes(document.edition.id)) return false;
	if (scope.types && !scope.types.includes(document.edition.type)) return false;
	if (scope.languages && !scope.languages.includes(document.edition.language ?? "")) return false;
	return !scope.surahs || scope.surahs.includes(document.surah);
}

function allOccurrences(haystack: string, needle: string): TextRange[] {
	const ranges: TextRange[] = [];
	let from = 0;
	while (from <= haystack.length - needle.length) {
		const start = haystack.indexOf(needle, from);
		if (start < 0) break;
		ranges.push({ start, end: start + needle.length });
		from = start + Math.max(1, needle.length);
	}
	return ranges;
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
	const sorted = ranges.sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: TextRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

function matchDocument(document: IndexedDocument, phrase: string, terms: string[]): { score: number; ranges: TextRange[] } | undefined {
	const normalized = document.normalized.text;
	const phraseRanges = allOccurrences(normalized, phrase);
	const termRanges = terms.flatMap((term) => allOccurrences(normalized, term));
	if (phraseRanges.length === 0 && terms.some((term) => !normalized.includes(term))) return undefined;

	const exact = normalized === phrase;
	const score = (exact ? 1_000 : phraseRanges.length > 0 ? 500 : 200) +
		Math.min(100, phraseRanges.length * 10 + termRanges.length) -
		Math.min(50, normalized.length / 200);
	const normalizedRanges = phraseRanges.length > 0 ? phraseRanges : termRanges;
	const ranges = normalizedRanges.map((range) =>
		normalizedRangeToSource(document.normalized, range.start, range.end, document.text.length)
	);
	return { score, ranges: mergeRanges(ranges) };
}

function snippet(text: string, ranges: TextRange[], radius: number): SearchSnippet {
	const first = ranges[0] ?? { start: 0, end: 0 };
	let start = Math.max(0, first.start - radius);
	let end = Math.min(text.length, first.end + radius);
	if (start > 0) {
		const boundary = text.lastIndexOf(" ", start);
		if (boundary >= Math.max(0, start - 20)) start = boundary + 1;
	}
	if (end < text.length) {
		const boundary = text.indexOf(" ", end);
		if (boundary >= 0 && boundary <= end + 20) end = boundary;
	}
	const visible = ranges
		.filter((range) => range.end > start && range.start < end)
		.map((range) => ({ start: Math.max(range.start, start) - start, end: Math.min(range.end, end) - start }));
	return { text: text.slice(start, end), start, end, matches: visible };
}

/** Pure in-memory search index. Callers own persistence and resource loading. */
export class OfflineQuranSearchIndex {
	private readonly documents: IndexedDocument[] = [];
	private readonly postings = new Map<string, Set<number>>();

	get size(): number {
		return this.documents.length;
	}

	editions(): SearchEdition[] {
		return [...new Map(this.documents.map((document) => [document.edition.id, document.edition])).values()]
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	add(input: SearchDocumentInput): boolean {
		const location = parseAyahKey(input.ayahKey);
		if (!location || input.text.trim().length === 0 || input.edition.id.length === 0) return false;
		const normalized = normalizeText(input.text);
		if (normalized.text.length === 0) return false;
		const id = this.documents.length;
		const document: IndexedDocument = { ...input, ...location, id, normalized };
		this.documents.push(document);
		for (const token of new Set(tokenize(normalized.text))) {
			let ids = this.postings.get(token);
			if (!ids) this.postings.set(token, (ids = new Set()));
			ids.add(id);
		}
		return true;
	}

	addAll(inputs: Iterable<SearchDocumentInput>): number {
		let added = 0;
		for (const input of inputs) if (this.add(input)) added++;
		return added;
	}

	search(query: string, options: SearchOptions = {}): SearchHit[] {
		const phrase = normalizeText(query).text;
		const terms = [...new Set(tokenize(phrase))];
		if (phrase.length < 2 || terms.length === 0) return [];
		const limit = Math.max(0, Math.floor(options.limit ?? DEFAULT_LIMIT));
		if (limit === 0) return [];

		const exactPostingSets = terms.map((term) => this.postings.get(term)).filter((set): set is Set<number> => set !== undefined);
		const candidateIds = exactPostingSets.length === terms.length
			? [...exactPostingSets.reduce((smallest, set) => set.size < smallest.size ? set : smallest)]
			: this.documents.map((document) => document.id);

		return candidateIds
			.map((id) => this.documents[id])
			.filter((document) => scoped(document, options.scope))
			.map((document) => ({ document, match: matchDocument(document, phrase, terms) }))
			.filter((entry): entry is { document: IndexedDocument; match: { score: number; ranges: TextRange[] } } => entry.match !== undefined)
			.sort((a, b) => b.match.score - a.match.score || a.document.surah - b.document.surah || a.document.ayah - b.document.ayah || a.document.edition.id.localeCompare(b.document.edition.id))
			.slice(0, limit)
			.map(({ document, match }) => ({
				ayahKey: document.ayahKey,
				ayahKeys: document.ayahKeys,
				surah: document.surah,
				ayah: document.ayah,
				edition: document.edition,
				text: document.text,
				snippet: snippet(document.text, match.ranges, Math.max(0, options.snippetRadius ?? DEFAULT_SNIPPET_RADIUS)),
				score: match.score,
			}));
	}
}

function defaultYield(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** Builds in bounded batches so loading several installed editions does not monopolize the UI thread. */
export async function buildOfflineQuranSearchIndex(
	inputs: readonly SearchDocumentInput[],
	options: AsyncBuildOptions = {}
): Promise<OfflineQuranSearchIndex> {
	const index = new OfflineQuranSearchIndex();
	const batchSize = Math.max(1, Math.floor(options.batchSize ?? 500));
	const yieldControl = options.yieldControl ?? defaultYield;
	options.onProgress?.({ indexed: 0, total: inputs.length });
	for (let offset = 0; offset < inputs.length; offset += batchSize) {
		if (options.signal?.aborted) throw new DOMException("Search indexing was aborted", "AbortError");
		index.addAll(inputs.slice(offset, offset + batchSize));
		options.onProgress?.({ indexed: Math.min(offset + batchSize, inputs.length), total: inputs.length });
		if (offset + batchSize < inputs.length) await yieldControl();
	}
	return index;
}

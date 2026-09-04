import type { AyahKey, WordDictionaryEntry, WordMorphology, WordSegment } from "../data/schema";

export interface WordByWordVerse {
	ayahKey: AyahKey;
	words: WordSegment[];
}

export interface WordViewOptions {
	showTranslation?: boolean;
	showTransliteration?: boolean;
}

/** UI-neutral representation used by both inline and reader renderers. */
export interface WordViewModel {
	key: string;
	position: number;
	arabic: string;
	gloss?: string;
	transliteration?: string;
	morphology?: WordMorphology;
	dictionary?: WordDictionaryEntry;
	hasSecondaryText: boolean;
}

export function parseWordByWord(input: unknown): WordByWordVerse[] {
	if (!Array.isArray(input)) return [];
	const verses: WordByWordVerse[] = [];
	for (const value of input) {
		if (!value || typeof value !== "object") continue;
		const row = value as Record<string, unknown>;
		if (typeof row.ayahKey !== "string" || !Array.isArray(row.words)) continue;
		const seenPositions = new Set<number>();
		const words = row.words.flatMap((word, index): WordSegment[] => {
			if (!word || typeof word !== "object") return [];
			const w = word as Record<string, unknown>;
			if (typeof w.text !== "string" || !w.text.trim()) return [];
			const suppliedPosition = typeof w.position === "number" && Number.isInteger(w.position)
				? w.position
				: index + 1;
			if (suppliedPosition < 1 || seenPositions.has(suppliedPosition)) return [];
			seenPositions.add(suppliedPosition);
			const morphology = parseMorphology(w.morphology);
			const dictionary = parseDictionary(w.dictionary);
			return [{
				position: suppliedPosition,
				text: w.text.trim(),
				translation: optionalText(w.translation),
				transliteration: optionalText(w.transliteration),
				...(morphology ? { morphology } : {}),
				...(dictionary ? { dictionary } : {}),
			}];
		});
		if (words.length) {
			words.sort((left, right) => left.position - right.position);
			verses.push({ ayahKey: row.ayahKey, words });
		}
	}
	return verses;
}

export function wordRange(words: WordSegment[], fromWord?: number, toWord?: number): WordSegment[] {
	const lastPosition = words.reduce((highest, word) => Math.max(highest, word.position), 0);
	const from = Math.max(1, Math.trunc(fromWord ?? 1));
	const to = Math.max(from, Math.trunc(toWord ?? lastPosition));
	return words.filter((word) => word.position >= from && word.position <= to);
}

export function buildWordViewModels(
	verse: WordByWordVerse,
	options: WordViewOptions = {},
): WordViewModel[] {
	const showTranslation = options.showTranslation ?? true;
	const showTransliteration = options.showTransliteration ?? true;

	return verse.words.map((word) => {
		const gloss = showTranslation ? optionalText(word.translation) : undefined;
		const transliteration = showTransliteration ? optionalText(word.transliteration) : undefined;
		return {
			key: `${verse.ayahKey}:${word.position}`,
			position: word.position,
			arabic: word.text,
			gloss,
			transliteration,
			...(word.morphology ? { morphology: word.morphology } : {}),
			...(word.dictionary ? { dictionary: word.dictionary } : {}),
			hasSecondaryText: gloss !== undefined || transliteration !== undefined,
		};
	});
}

function parseMorphology(value: unknown): WordMorphology | undefined {
	if (!value || typeof value !== "object") return undefined;
	const row = value as WordMorphology;
	if (typeof row.location !== "string" || !Array.isArray(row.segments)) return undefined;
	return row;
}

function parseDictionary(value: unknown): WordDictionaryEntry | undefined {
	if (!value || typeof value !== "object") return undefined;
	const row = value as WordDictionaryEntry;
	if (!Array.isArray(row.senses)) return undefined;
	return row;
}

function optionalText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

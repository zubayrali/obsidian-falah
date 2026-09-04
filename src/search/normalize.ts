import type { TextRange } from "./types";

const ARABIC_MARK = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/u;
const COMBINING_MARK = /\p{M}/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

const ARABIC_EQUIVALENTS: Readonly<Record<string, string>> = {
	"أ": "ا",
	"إ": "ا",
	"آ": "ا",
	"ٱ": "ا",
	"ى": "ي",
	"ؤ": "و",
	"ئ": "ي",
};

export interface NormalizedText {
	text: string;
	/** For each normalized code unit, the corresponding original UTF-16 offset. */
	map: number[];
}

/**
 * Normalizes Arabic and Latin text while retaining a map back to the source.
 * Arabic vocalization/tatweel and Latin combining accents are ignored;
 * punctuation and whitespace become a single searchable space.
 */
export function normalizeText(source: string): NormalizedText {
	let text = "";
	const map: number[] = [];
	let pendingSpaceAt: number | undefined;

	for (let offset = 0; offset < source.length;) {
		const original = String.fromCodePoint(source.codePointAt(offset) ?? 0);
		const originalLength = original.length;
		offset += originalLength;

		if (original === "ـ" || ARABIC_MARK.test(original)) continue;
		const folded = (ARABIC_EQUIVALENTS[original] ?? original)
			.normalize("NFKD")
			.toLocaleLowerCase("und");

		for (const character of folded) {
			if (COMBINING_MARK.test(character)) continue;
			if (!LETTER_OR_NUMBER.test(character)) {
				if (text.length > 0) pendingSpaceAt ??= offset - originalLength;
				continue;
			}
			if (pendingSpaceAt !== undefined) {
				text += " ";
				map.push(pendingSpaceAt);
				pendingSpaceAt = undefined;
			}
			text += character;
			for (let i = 0; i < character.length; i++) map.push(offset - originalLength);
		}
	}

	return { text, map };
}

export function normalizedRangeToSource(
	normalized: NormalizedText,
	start: number,
	end: number,
	sourceLength: number
): TextRange {
	const sourceStart = normalized.map[start] ?? sourceLength;
	const lastOffset = normalized.map[Math.max(start, end - 1)] ?? sourceStart;
	const nextOffset = normalized.map.slice(end).find((offset) => offset > lastOffset);
	return { start: sourceStart, end: nextOffset ?? sourceLength };
}

export function tokenize(normalized: string): string[] {
	return normalized.length === 0 ? [] : normalized.split(" ").filter(Boolean);
}

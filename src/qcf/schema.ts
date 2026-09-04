export const QCF_PAGE_COUNT = 604;

export type QcfWordType = "word" | "end" | "surah_header" | "bismillah" | "quarter";

export interface QcfWord {
	code: number;
	char: string;
	font: string;
	text?: string;
	type: QcfWordType;
	verse_key?: string;
	position?: number;
	sura?: number;
}

export interface QcfLine {
	line: number;
	words: QcfWord[];
}

export interface QcfSurahSpan {
	id: number;
	name: string;
	name_arabic: string;
	verse_start: number;
	verse_end: number;
}

export interface QcfPage {
	page: number;
	font: string;
	surahs: QcfSurahSpan[];
	lines: QcfLine[];
}

const WORD_TYPES = new Set<QcfWordType>(["word", "end", "surah_header", "bismillah", "quarter"]);

export function parseQcfPage(value: unknown, expectedPage?: number): QcfPage {
	if (!value || typeof value !== "object") throw new Error("Invalid QCF page: expected an object");
	const page = value as Partial<QcfPage>;
	if (!Number.isInteger(page.page) || (expectedPage !== undefined && page.page !== expectedPage)) {
		throw new Error(`Invalid QCF page number${expectedPage ? ` (expected ${expectedPage})` : ""}`);
	}
	if (typeof page.font !== "string" || !/^QCF4_Hafs_\d{2}$/.test(page.font)) {
		throw new Error("Invalid QCF page font");
	}
	if (!Array.isArray(page.surahs) || !Array.isArray(page.lines)) throw new Error("Invalid QCF page structure");
	for (const line of page.lines) {
		if (!line || !Number.isInteger(line.line) || !Array.isArray(line.words)) throw new Error("Invalid QCF line");
		for (const word of line.words) {
			if (!word || typeof word.char !== "string" || typeof word.font !== "string" || !WORD_TYPES.has(word.type)) {
				throw new Error("Invalid QCF word");
			}
		}
	}
	return page as QcfPage;
}

export function qcfFontFile(font: string): string {
	if (font === "QCF4_QBSML") return "QCF4_QBSML.woff2";
	if (!/^QCF4_Hafs_\d{2}$/.test(font)) throw new Error(`Unsupported QCF font: ${font}`);
	return `${font}_W.woff2`;
}

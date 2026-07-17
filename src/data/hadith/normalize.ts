// Pure normalizers: raw source payloads → HadithCollection. One function per
// source. No Obsidian, no network — fully unit-tested. Each source's quirks are
// contained here.

import { SchemaError } from "../schema";
import type { HadithCatalogEntry, HadithCollection, NormHadith } from "./schema";

interface FawazHadith {
	hadithnumber?: number;
	text?: string;
	grades?: { name?: string; grade?: string }[];
	reference?: { book?: number; hadith?: number };
}
interface FawazEdition {
	metadata?: { name?: string };
	hadiths?: FawazHadith[];
}

function cleanGrades(g: FawazHadith["grades"]): { name: string; grade: string }[] | undefined {
	if (!Array.isArray(g) || g.length === 0) return undefined;
	const out = g
		.filter((x) => x && (x.name || x.grade))
		.map((x) => ({ name: String(x.name ?? ""), grade: String(x.grade ?? "") }));
	return out.length ? out : undefined;
}

/** Merge a fawazahmed0 arabic edition with an optional translation edition,
 *  joining on hadithnumber. `language` is the translation edition's language
 *  code ("ara" when arabic-only). */
export function normalizeFawaz(
	arabicEd: unknown,
	translationEd: unknown,
	meta: { source: string; collection: string; language: string }
): HadithCollection {
	const ar = arabicEd as FawazEdition;
	if (!ar || !Array.isArray(ar.hadiths)) throw new SchemaError(`${meta.collection}: fawaz arabic edition missing hadiths`);
	const tr = (translationEd as FawazEdition | null) ?? null;
	const trByNum = new Map<number, FawazHadith>();
	if (tr && Array.isArray(tr.hadiths)) {
		for (const h of tr.hadiths) if (typeof h.hadithnumber === "number") trByNum.set(h.hadithnumber, h);
	}
	const hadiths: NormHadith[] = [];
	for (const h of ar.hadiths) {
		if (typeof h.hadithnumber !== "number") continue;
		const t = trByNum.get(h.hadithnumber);
		const nh: NormHadith = { number: h.hadithnumber };
		if (typeof h.text === "string") nh.arabic = h.text;
		if (t && typeof t.text === "string") nh.translation = t.text;
		const grades = cleanGrades(t?.grades) ?? cleanGrades(h.grades);
		if (grades) nh.grades = grades;
		const ref = h.reference ?? t?.reference;
		if (ref && typeof ref.book === "number" && typeof ref.hadith === "number") {
			nh.reference = { book: ref.book, hadith: ref.hadith };
		}
		hadiths.push(nh);
	}
	const name = (tr?.metadata?.name || ar.metadata?.name) ?? meta.collection;
	return {
		source: meta.source,
		collection: meta.collection,
		language: meta.language,
		name,
		nameArabic: ar.metadata?.name,
		hadiths,
	};
}

interface AhmedBasetBook {
	metadata?: { arabic?: { title?: string }; english?: { title?: string } };
	chapters?: { id?: number; arabic?: string; english?: string }[];
	hadiths?: {
		idInBook?: number;
		chapterId?: number;
		arabic?: string;
		english?: { narrator?: string; text?: string };
	}[];
}

/** AhmedBaset/hadith-json per-book file → HadithCollection. Carries narrator +
 *  chapter; no grades in this dataset. */
export function normalizeAhmedBaset(
	bookJson: unknown,
	meta: { collection: string; language: string }
): HadithCollection {
	const b = bookJson as AhmedBasetBook;
	if (!b || !Array.isArray(b.hadiths)) throw new SchemaError(`${meta.collection}: ahmedbaset file missing hadiths`);
	const hadiths: NormHadith[] = [];
	for (const h of b.hadiths) {
		if (typeof h.idInBook !== "number") continue;
		const nh: NormHadith = { number: h.idInBook };
		if (typeof h.arabic === "string") nh.arabic = h.arabic;
		if (h.english && typeof h.english.text === "string") nh.translation = h.english.text;
		if (h.english && typeof h.english.narrator === "string" && h.english.narrator) nh.narrator = h.english.narrator;
		if (typeof h.chapterId === "number") nh.chapter = { number: h.chapterId };
		hadiths.push(nh);
	}
	const books = Array.isArray(b.chapters)
		? b.chapters
				.filter((c) => typeof c.id === "number")
				.map((c) => ({ number: c.id as number, arabic: c.arabic, english: c.english }))
		: undefined;
	return {
		source: "ahmedbaset",
		collection: meta.collection,
		language: meta.language,
		name: b.metadata?.english?.title ?? meta.collection,
		nameArabic: b.metadata?.arabic?.title,
		books,
		hadiths,
	};
}

interface SunnahBody {
	lang?: string;
	body?: string;
	chapterTitle?: string;
	grades?: { graded_by?: string; grade?: string }[];
}
interface SunnahHadith {
	hadithNumber?: string | number;
	hadith?: SunnahBody[];
}
interface SunnahInput {
	collection?: { name?: string };
	hadiths?: SunnahHadith[];
}

/** sunnah.com hadith list → HadithCollection. Each item carries per-language
 *  bodies; we take the "ar" body as arabic and the "en" body as translation. */
export function normalizeSunnah(
	input: unknown,
	meta: { collection: string; language: string }
): HadithCollection {
	const inp = input as SunnahInput;
	if (!inp || !Array.isArray(inp.hadiths)) throw new SchemaError(`${meta.collection}: sunnah input missing hadiths`);
	const hadiths: NormHadith[] = [];
	for (const h of inp.hadiths) {
		const num = typeof h.hadithNumber === "number" ? h.hadithNumber : parseInt(String(h.hadithNumber ?? ""), 10);
		if (!Number.isFinite(num)) continue;
		const bodies = Array.isArray(h.hadith) ? h.hadith : [];
		const ar = bodies.find((b) => b.lang === "ar");
		const en = bodies.find((b) => b.lang === "en");
		const nh: NormHadith = { number: num };
		if (ar?.body) nh.arabic = ar.body;
		if (en?.body) nh.translation = en.body;
		const g = (en?.grades ?? [])
			.filter((x) => x && (x.graded_by || x.grade))
			.map((x) => ({ name: String(x.graded_by ?? ""), grade: String(x.grade ?? "") }));
		if (g.length) nh.grades = g;
		if (en?.chapterTitle || ar?.chapterTitle) {
			nh.chapter = { english: en?.chapterTitle, arabic: ar?.chapterTitle };
		}
		hadiths.push(nh);
	}
	return {
		source: "sunnah",
		collection: meta.collection,
		language: meta.language,
		name: inp.collection?.name ?? meta.collection,
		hadiths,
	};
}

/** mhashim6 Open-Hadith CSV → HadithCollection. Real format is 2-column
 *  `"number","arabic text"` per line (number explicit, text diacritized).
 *  Un-doubles `""`, trims RLM/whitespace, skips non-matching lines.
 *  ponytail: line-per-record holds for these files; if a book ever embeds a
 *  newline inside a quoted field, add a proper CSV tokenizer then. */
export function parseMhashimCsv(csvText: string, meta: { collection: string; name: string }): HadithCollection {
	const hadiths: NormHadith[] = [];
	const row = /^\s*"(\d+)"\s*,\s*"([\s\S]*)"\s*$/;
	for (const line of csvText.split(/\r?\n/)) {
		const m = row.exec(line);
		if (!m) continue;
		const number = parseInt(m[1], 10);
		if (!Number.isFinite(number)) continue;
		const arabic = m[2].replace(/""/g, '"').replace(/‏/g, "").trim();
		if (!arabic) continue;
		hadiths.push({ number, arabic });
	}
	return {
		source: "mhashim6",
		collection: meta.collection,
		language: "ara",
		name: meta.name,
		hadiths,
	};
}

interface FawazEditionsMap {
	[collection: string]: { name?: string; collection?: { name?: string }[] };
}

/** fawazahmed0 editions.json → catalog entries (one per collection). Language
 *  codes are the 3-letter prefix of each edition name (e.g. "eng-bukhari" → "eng"). */
export function parseFawazHadithEditions(editionsJson: unknown): HadithCatalogEntry[] {
	const map = editionsJson as FawazEditionsMap;
	if (!map || typeof map !== "object") return [];
	const out: HadithCatalogEntry[] = [];
	for (const [collection, entry] of Object.entries(map)) {
		const editions = Array.isArray(entry?.collection) ? entry.collection : [];
		const langs = new Set<string>();
		for (const ed of editions) {
			const dash = typeof ed?.name === "string" ? ed.name.indexOf("-") : -1;
			if (dash > 0) langs.add(ed.name!.slice(0, dash));
		}
		out.push({
			source: "fawazahmed0",
			collection,
			name: entry?.name ?? collection,
			languages: [...langs].sort(),
		});
	}
	return out;
}

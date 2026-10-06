import type { HadithRef } from "../../ref";
import type { HadithProvider, HadithSearchResult } from "../../providers";
import type { FetchJson } from "../download";
import { NetworkError, NotFoundError, SchemaError } from "../schema";
import type { HadithContent } from "../schema";
import type { HadithCatalogEntry, HadithCollection, NormHadith } from "./schema";
import type { HadithSource } from "./sources";

const BASE = "https://hadithunlocked.com";
// Stable Falah collection ids; URL slugs stay inside this adapter.
const BOOKS: Record<string, { slug: string; name: string }> = {
	bukhari: { slug: "bukhari", name: "Sahih al-Bukhari" },
	muslim: { slug: "muslim", name: "Sahih Muslim" },
	abudawud: { slug: "abudawud", name: "Sunan Abi Dawud" },
	tirmidhi: { slug: "tirmidhi", name: "Jami' at-Tirmidhi" },
	nasai: { slug: "nasai", name: "Sunan an-Nasa'i" },
	ibnmajah: { slug: "ibnmajah", name: "Sunan Ibn Majah" },
	malik: { slug: "malik", name: "Muwatta Malik" },
	darimi: { slug: "darimi", name: "Sunan ad-Darimi" },
	riyad_assalihin: { slug: "riyad", name: "Riyad as-Salihin" },
	adab_almufrad: { slug: "adab", name: "Al-Adab Al-Mufrad" },
	shamail_muhammadiyah: { slug: "shamail", name: "Shama'il Muhammadiyah" },
};
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
	return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.replace(/\\n/g, "\n").trim() : undefined;
}
function localized(value: unknown, language: string): string | undefined { return text(record(value)[language]); }

function normalizeItem(raw: unknown, ordinal: number, live: boolean): NormHadith | undefined {
	const row = record(raw);
	const identifier = live ? row.num : row.number;
	if (typeof identifier !== "string" && typeof identifier !== "number") return undefined;
	const referenceNumber = String(identifier).toLowerCase();
	if (!/^\d+(?:-\d+)?[a-z]?$/.test(referenceNumber)) return undefined;
	const arabic = live ? text(row.body) : localized(row.text, "ar");
	const translation = live ? text(row.body_en) : localized(row.text, "en");
	if (!arabic && !translation) return undefined;
	const chain = live ? text(row.chain) : localized(row.chain, "ar");
	const grade = live ? text(row.grade_grade_en) : localized(row.grade, "en");
	const grader = live ? text(row.grader_shortName_en) : localized(row.grader, "en");
	return {
		number: ordinal, referenceNumber,
		arabic: [chain, arabic].filter(Boolean).join("\n\n") || undefined,
		translation, narrator: live ? text(row.chain_en) : localized(row.chain, "en"),
		...(grade ? { grades: [{ name: grader ?? "", grade }] } : {}),
	};
}

/** Offline exports are book-v42 chapters/items, not the array used by ?json. */
export function normalizeUnlockedBook(raw: unknown, collection: string, language: string): HadithCollection {
	const body = record(raw);
	const book = record(body.book);
	const expected = Object.prototype.hasOwnProperty.call(BOOKS, collection) ? BOOKS[collection] : undefined;
	if (!expected || book.alias !== expected.slug || !Array.isArray(body.chapters)) throw new SchemaError("Hadith Unlocked: mismatched book or missing chapters");
	const hadiths: NormHadith[] = [];
	const seen = new Set<string>();
	const visit = (value: unknown) => {
		const chapter = record(value);
		for (const item of Array.isArray(chapter.items) ? chapter.items : []) {
			const h = normalizeItem(item, hadiths.length + 1, false);
			if (!h || seen.has(h.referenceNumber!)) continue;
			seen.add(h.referenceNumber!);
			h.chapter = { english: localized(chapter.title, "en"), arabic: localized(chapter.title, "ar") };
			h.sourceUrl = `${BASE}/${expected.slug}:${h.referenceNumber!}`;
			hadiths.push(h);
		}
		// Some books group chapters into sections; introductory headings have no items.
		for (const child of Array.isArray(chapter.sections) ? chapter.sections : []) visit(child);
		for (const child of Array.isArray(chapter.chapters) ? chapter.chapters : []) visit(child);
	};
	for (const chapter of body.chapters) visit(chapter);
	if (!hadiths.length || !hadiths.some((h) => language === "eng" ? h.translation : h.arabic)) throw new SchemaError("Hadith Unlocked: no content in the selected language");
	return { source: "hadith-unlocked", collection, language, name: localized(book.title, "en") ?? expected.name, nameArabic: localized(book.title, "ar"), hadiths };
}

export class HadithUnlockedSource implements HadithSource {
	readonly id = "hadith-unlocked";
	async listCatalog(): Promise<HadithCatalogEntry[]> {
		return Object.entries(BOOKS).map(([collection, book]) => ({ source: this.id, collection, name: book.name, languages: ["ara", "eng"] }));
	}
	async fetchCollection(collection: string, language: string, fetchJson: FetchJson, signal?: AbortSignal): Promise<HadithCollection> {
		const book = Object.prototype.hasOwnProperty.call(BOOKS, collection) ? BOOKS[collection] : undefined;
		if (!book || !["ara", "eng"].includes(language)) throw new NotFoundError("Unsupported Hadith Unlocked collection or language");
		signal?.throwIfAborted();
		const raw = await fetchJson(`${BASE}/${book.slug}.json`);
		signal?.throwIfAborted();
		return normalizeUnlockedBook(raw, collection, language);
	}
}

/** Exact identity matching: never substitute 8, 8b, or the first result for 8a. */
export class HadithUnlockedProvider implements HadithProvider {
	private inflight = new Map<string, Promise<HadithContent>>();
	constructor(private fetchJson: FetchJson) {}
	async getHadith(ref: HadithRef): Promise<HadithContent> {
		const book = Object.prototype.hasOwnProperty.call(BOOKS, ref.collection) ? BOOKS[ref.collection] : undefined;
		if (!book || !/^\d+(?:-\d+)?[a-z]?$/.test(ref.number)) throw new NotFoundError("Unsupported Hadith Unlocked reference");
		const key = `${book.slug}:${ref.number}`;
		const pending = this.inflight.get(key);
		if (pending) return pending;
		const load = this.fetchExact(ref, key, book.name);
		this.inflight.set(key, load);
		try { return await load; } finally { this.inflight.delete(key); }
	}
	private async fetchExact(ref: HadithRef, key: string, name: string): Promise<HadithContent> {
		let raw: unknown;
		try { raw = await this.fetchJson(`${BASE}/${key}?json`); }
		catch (error) { throw new NetworkError(`Hadith Unlocked: ${error instanceof Error ? error.message : String(error)}`); }
		if (!Array.isArray(raw)) throw new SchemaError("Hadith Unlocked lookup: expected array");
		const row: unknown = (raw as unknown[]).find((value) => {
			const item = record(value);
			if (item.ref === key) return true;
			// Anthologies return the original narration plus an explicit anthology reference.
			return Array.isArray(item.virtualReferences) && (item.virtualReferences as unknown[]).some((v) => {
				const virtual = record(v);
				return `${text(virtual.book_alias) ?? ""}:${text(virtual.num) ?? ""}` === key;
			});
		});
		const h = normalizeItem(row, 1, true);
		if (!h) throw new NotFoundError(`Hadith ${key} not found`);
		return { ref, arabic: h.arabic, translation: h.translation, narrator: h.narrator, grades: h.grades?.map((g) => [g.name, g.grade].filter(Boolean).join(": ")).join(" · "), bookName: name, externalUrl: `${BASE}/${key}` };
	}
	async search(_query: string): Promise<HadithSearchResult[]> { return []; }
}

export class FallbackHadithProvider implements HadithProvider {
	constructor(private primary: HadithProvider, private fallback: HadithProvider) {}
	async getHadith(ref: HadithRef): Promise<HadithContent> {
		try { return await this.primary.getHadith(ref); }
		catch (error) {
			if (error instanceof SchemaError) throw error;
			return this.fallback.getHadith(ref);
		}
	}
	search(query: string): Promise<HadithSearchResult[]> { return this.primary.search(query); }
}

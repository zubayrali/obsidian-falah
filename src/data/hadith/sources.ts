// Source adapters: each knows one dataset's URLs + shapes and normalizes to
// HadithCollection. Network methods are NOT unit-tested (policy); the pure
// catalog constants are. fetchCollection is cancellable via AbortSignal where
// the underlying transport supports it (checked before each request).

import { DataError, NetworkError } from "../schema";
import type { FetchJson } from "../download";
import {
	normalizeAhmedBaset,
	normalizeFawaz,
	normalizeSunnah,
	parseFawazHadithEditions,
	parseMhashimCsv,
} from "./normalize";
import type { HadithCatalogEntry, HadithCollection } from "./schema";

export interface HadithSource {
	readonly id: string;
	readonly needsApiKey?: boolean;
	listCatalog(fetchJson: FetchJson): Promise<HadithCatalogEntry[]>;
	fetchCollection(
		collection: string,
		language: string,
		fetchJson: FetchJson,
		signal?: AbortSignal
	): Promise<HadithCollection>;
}

async function fetchJsonOrThrow(fetchJson: FetchJson, url: string): Promise<unknown> {
	try {
		return await fetchJson(url);
	} catch (err) {
		if (err instanceof DataError) throw err;
		throw new NetworkError(`Request failed: ${url}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

const FAWAZ = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1";

export class Fawazahmed0HadithSource implements HadithSource {
	readonly id = "fawazahmed0";
	async listCatalog(fetchJson: FetchJson): Promise<HadithCatalogEntry[]> {
		return parseFawazHadithEditions(await fetchJsonOrThrow(fetchJson, `${FAWAZ}/editions.json`));
	}
	async fetchCollection(collection: string, language: string, fetchJson: FetchJson): Promise<HadithCollection> {
		const araJson = await fetchJsonOrThrow(fetchJson, `${FAWAZ}/editions/ara-${collection}.min.json`);
		let transJson: unknown = null;
		if (language !== "ara") {
			transJson = await fetchJsonOrThrow(fetchJson, `${FAWAZ}/editions/${language}-${collection}.min.json`);
		}
		return normalizeFawaz(araJson, transJson, { source: this.id, collection, language });
	}
}

const AHMEDBASET_RAW = "https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book";
// group → path segment on the CDN
const AHMEDBASET_PATHS: Record<string, "the_9_books" | "forties" | "other_books"> = {
	bukhari: "the_9_books", muslim: "the_9_books", nasai: "the_9_books", abudawud: "the_9_books",
	tirmidhi: "the_9_books", ibnmajah: "the_9_books", malik: "the_9_books", ahmed: "the_9_books", darimi: "the_9_books",
	nawawi: "forties", qudsi: "forties", shahwaliullah: "forties",
	riyad_assalihin: "other_books", adab_almufrad: "other_books", bulugh_almaram: "other_books",
	shamail_muhammadiyah: "other_books", mishkat_almasabih: "other_books",
};
export const AHMEDBASET_BOOKS: HadithCatalogEntry[] = [
	["bukhari", "Sahih al-Bukhari"], ["muslim", "Sahih Muslim"], ["nasai", "Sunan an-Nasa'i"],
	["abudawud", "Sunan Abi Dawud"], ["tirmidhi", "Jami' at-Tirmidhi"], ["ibnmajah", "Sunan Ibn Majah"],
	["malik", "Muwatta Malik"], ["ahmed", "Musnad Ahmad"], ["darimi", "Sunan ad-Darimi"],
	["nawawi", "40 Hadith Nawawi"], ["qudsi", "40 Hadith Qudsi"], ["shahwaliullah", "40 Hadith Shah Waliullah"],
	["riyad_assalihin", "Riyad as-Salihin"], ["adab_almufrad", "Al-Adab Al-Mufrad"],
	["bulugh_almaram", "Bulugh al-Maram"], ["shamail_muhammadiyah", "Shama'il Muhammadiyah"],
	["mishkat_almasabih", "Mishkat al-Masabih"],
].map(([collection, name]) => ({ source: "ahmedbaset", collection, name, languages: ["ara", "eng"] }));

export class AhmedBasetHadithSource implements HadithSource {
	readonly id = "ahmedbaset";
	async listCatalog(): Promise<HadithCatalogEntry[]> {
		return AHMEDBASET_BOOKS;
	}
	async fetchCollection(collection: string, language: string, fetchJson: FetchJson): Promise<HadithCollection> {
		const group = AHMEDBASET_PATHS[collection] ?? "other_books";
		const json = await fetchJsonOrThrow(fetchJson, `${AHMEDBASET_RAW}/${group}/${collection}.json`);
		return normalizeAhmedBaset(json, { collection, language: language || "eng" });
	}
}

const SUNNAH_API = "https://api.sunnah.com/v1";

export class SunnahComHadithSource implements HadithSource {
	readonly id = "sunnah";
	readonly needsApiKey = true;
	constructor(private apiKey: () => string) {}
	private requireKey(): string {
		const k = this.apiKey();
		if (!k) throw new NetworkError("sunnah.com needs an API key — set it in Falah settings (request one at github.com/sunnah-com/api).");
		return k;
	}
	async listCatalog(fetchJson: FetchJson): Promise<HadithCatalogEntry[]> {
		this.requireKey();
		const json = (await fetchJsonOrThrow(fetchJson, `${SUNNAH_API}/collections?limit=50`)) as {
			data?: { name?: string; collection?: { lang?: string; title?: string }[] }[];
		};
		return (json.data ?? [])
			.filter((c) => typeof c.name === "string")
			.map((c) => ({
				source: "sunnah",
				collection: c.name as string,
				name: c.collection?.find((t) => t.lang === "en")?.title ?? (c.name as string),
				languages: ["ara", "eng"],
			}));
	}
	async fetchCollection(collection: string, language: string, fetchJson: FetchJson, signal?: AbortSignal): Promise<HadithCollection> {
		this.requireKey();
		const all: unknown[] = [];
		let name = collection;
		for (let page = 1; page <= 200; page++) {
			if (signal?.aborted) break;
			const json = (await fetchJsonOrThrow(fetchJson, `${SUNNAH_API}/collections/${collection}/hadiths?page=${page}&limit=100`)) as {
				data?: unknown[]; collection?: { name?: string };
			};
			if (json.collection?.name) name = json.collection.name;
			const data = Array.isArray(json.data) ? json.data : [];
			all.push(...data);
			if (data.length < 100) break;
		}
		return normalizeSunnah({ collection: { name }, hadiths: all }, { collection, language: language || "eng" });
	}
}

const MHASHIM_RAW = "https://raw.githubusercontent.com/mhashim6/Open-Hadith-Data/master";
// Exact repo paths (verified live 2026-07-15). Diacritized variant. Ahmad's
// suffix differs. No URL-encoding needed — the repo uses underscores, not spaces.
const MHASHIM_PATHS: Record<string, string> = {
	bukhari: "Sahih_Al-Bukhari/sahih_al-bukhari_ahadith_mushakkala_mufassala.utf8.csv",
	muslim: "Sahih_Muslim/sahih_muslim_ahadith_mushakkala_mufassala.utf8.csv",
	tirmidhi: "Sunan_Al-Tirmidhi/sunan_al-tirmidhi_ahadith_mushakkala_mufassala.utf8.csv",
	abudawud: "Sunan_Abu-Dawud/sunan_abu-dawud_ahadith_mushakkala_mufassala.utf8.csv",
	nasai: "Sunan_Al-Nasai/sunan_al-nasai_ahadith_mushakkala_mufassala.utf8.csv",
	ibnmajah: "Sunan_Ibn-Maja/sunan_ibn-maja_ahadith_mushakkala_mufassala.utf8.csv",
	malik: "Maliks_Muwataa/maliks_muwataa_ahadith_mushakkala_mufassala.utf8.csv",
	ahmed: "Musnad_Ahmad_Ibn-Hanbal/musnad_ahmad_ibn-hanbal_ahadith_mushakkala.utf8.csv",
	darimi: "Sunan_Al-Darimi/sunan_al-darimi_ahadith_mushakkala_mufassala.utf8.csv",
};
export const MHASHIM_BOOKS: HadithCatalogEntry[] = [
	["bukhari", "Sahih al-Bukhari"], ["muslim", "Sahih Muslim"], ["tirmidhi", "Jami' at-Tirmidhi"],
	["abudawud", "Sunan Abi Dawud"], ["nasai", "Sunan an-Nasa'i"], ["ibnmajah", "Sunan Ibn Majah"],
	["malik", "Muwatta Malik"], ["ahmed", "Musnad Ahmad"], ["darimi", "Sunan ad-Darimi"],
].map(([collection, name]) => ({ source: "mhashim6", collection, name, languages: ["ara"] }));

/** Fetch text (CSV) through the injected JSON transport. The Obsidian FetchJson
 *  wraps requestUrl; for CSV we need the raw text, so wire-up (Task 12) provides
 *  a text-capable fetch. Here we accept a FetchJson that may return a string. */
export class OpenHadithCsvSource implements HadithSource {
	readonly id = "mhashim6";
	async listCatalog(): Promise<HadithCatalogEntry[]> {
		return MHASHIM_BOOKS;
	}
	async fetchCollection(collection: string, _language: string, fetchJson: FetchJson): Promise<HadithCollection> {
		const path = MHASHIM_PATHS[collection];
		if (!path) throw new NetworkError(`mhashim6 has no CSV mapping for "${collection}"`);
		const raw = await fetchJsonOrThrow(fetchJson, `${MHASHIM_RAW}/${path}`);
		const text = typeof raw === "string" ? raw : String(raw);
		const name = MHASHIM_BOOKS.find((b) => b.collection === collection)?.name ?? collection;
		return parseMhashimCsv(text, { collection, name });
	}
}

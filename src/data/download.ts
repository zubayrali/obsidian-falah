// DownloadSource adapters + provider-generic pipeline (spec §5.4). Each adapter
// knows one provider's shape; downloadResource is provider-generic.

import { DataError, NetworkError, NotFoundError, SchemaError } from "./schema";
import type { DownloadSourceId, ResourceDescriptor, ResourceType, TafsirVerse, TranslationVerse } from "./schema";
import {
	normalizeAlQuranAyahs,
	normalizeAlQuranFull,
	normalizeAlQuranEditions,
	normalizeFawazEditions,
	normalizeFawazSurah,
	normalizeQulCatalog,
	normalizeQulRange,
	normalizeQulTafsirRange,
} from "./normalize";
import { categoryForType } from "./store";
import type { DataStore } from "./store";
import type { Registry } from "./registry";

export type FetchJson = (url: string) => Promise<unknown>;

export interface DownloadProgress {
	surahsDone: number;
	surahsTotal: number;
}

export interface DownloadOptions {
	/** Overwrite every surah, but only commit the new descriptor/version after
	 * the whole replacement succeeds. Existing data remains readable on failure. */
	replaceExisting?: boolean;
}

export interface DownloadSource {
	readonly id: DownloadSourceId;
	/** Resources this source offers, normalized to descriptors. */
	listCatalog(type: ResourceType): Promise<ResourceDescriptor[]>;
	/** Fetch one surah of one resource, normalized to our schema. */
	fetchSurah(
		desc: ResourceDescriptor,
		surah: number,
		ayahCount: number,
		fetchJson: FetchJson
	): Promise<TranslationVerse[] | TafsirVerse[]>;
	/** Optional bulk endpoint, used by providers that otherwise rate-limit per-surah requests. */
	fetchAllSurahs?(
		desc: ResourceDescriptor,
		fetchJson: FetchJson,
	): Promise<Map<number, TranslationVerse[] | TafsirVerse[]>>;
}

/** Every network call in this module goes through here so a failed/non-OK fetch
 *  (the injected FetchJson throwing) surfaces as a typed NetworkError rather than
 *  a raw exception (spec: "every failure is a typed error"). A DataError thrown by
 *  fetchJson itself passes through unwrapped since it's already typed. */
async function fetchOrThrowNetwork(fetchJson: FetchJson, url: string): Promise<unknown> {
	try {
		return await fetchJson(url);
	} catch (err) {
		if (err instanceof DataError) throw err;
		const reason = err instanceof Error ? err.message : String(err);
		throw new NetworkError(`Request failed: ${url}: ${reason}`);
	}
}

const FAWAZ_EDITIONS_URL = "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions.json";
const fawazSurahUrl = (slug: string, surah: number) =>
	`https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/${slug}/${surah}.json`;

export class Fawazahmed0Source implements DownloadSource {
	readonly id: DownloadSourceId = "fawazahmed0";
	constructor(private fetchJsonForCatalog: FetchJson) {}

	async listCatalog(type: ResourceType): Promise<ResourceDescriptor[]> {
		if (type !== "translation") return []; // A ships this source for translations only (§3)
		return normalizeFawazEditions(await fetchOrThrowNetwork(this.fetchJsonForCatalog, FAWAZ_EDITIONS_URL));
	}

	async fetchSurah(
		desc: ResourceDescriptor,
		surah: number,
		_ayahCount: number,
		fetchJson: FetchJson
	): Promise<TranslationVerse[]> {
		if (!desc.sourceResourceId) throw new SchemaError(`${desc.id}: missing sourceResourceId`);
		const json = await fetchOrThrowNetwork(fetchJson, fawazSurahUrl(desc.sourceResourceId, surah));
		return normalizeFawazSurah(json, surah);
	}
}

const ALQURAN_EDITIONS_URL = "https://api.alquran.cloud/v1/edition";
const alQuranSurahUrl = (edition: string, surah: number) =>
	`https://api.alquran.cloud/v1/surah/${surah}/${edition}`;
const alQuranFullUrl = (edition: string) => `https://api.alquran.cloud/v1/quran/${edition}`;

export class AlQuranCloudSource implements DownloadSource {
	readonly id: DownloadSourceId = "alquran-cloud";
	constructor(private fetchJsonForCatalog: FetchJson) {}

	async listCatalog(type: ResourceType): Promise<ResourceDescriptor[]> {
		const all = normalizeAlQuranEditions(
			await fetchOrThrowNetwork(this.fetchJsonForCatalog, ALQURAN_EDITIONS_URL)
		);
		return all.filter((d) => d.type === type);
	}

	async fetchSurah(
		desc: ResourceDescriptor,
		surah: number,
		_ayahCount: number,
		fetchJson: FetchJson
	): Promise<TranslationVerse[]> {
		if (!desc.sourceResourceId) throw new SchemaError(`${desc.id}: missing sourceResourceId`);
		const json = await fetchOrThrowNetwork(fetchJson, alQuranSurahUrl(desc.sourceResourceId, surah));
		return normalizeAlQuranAyahs(json, surah);
	}

	async fetchAllSurahs(
		desc: ResourceDescriptor,
		fetchJson: FetchJson,
	): Promise<Map<number, TranslationVerse[]>> {
		if (!desc.sourceResourceId) throw new SchemaError(`${desc.id}: missing sourceResourceId`);
		const json = await fetchOrThrowNetwork(fetchJson, alQuranFullUrl(desc.sourceResourceId));
		return normalizeAlQuranFull(json);
	}
}

const QURAN_COM_API = "https://api.quran.com/api/v4";

export class QulSource implements DownloadSource {
	readonly id: DownloadSourceId = "qul";
	constructor(private fetchJsonForCatalog: FetchJson) {}

	async listCatalog(type: ResourceType): Promise<ResourceDescriptor[]> {
		if (type !== "translation" && type !== "tafsir") return [];
		const path = type === "translation" ? "translations" : "tafsirs";
		return normalizeQulCatalog(
			await fetchOrThrowNetwork(this.fetchJsonForCatalog, `${QURAN_COM_API}/resources/${path}`),
			type
		);
	}

	async fetchSurah(
		desc: ResourceDescriptor,
		surah: number,
		_ayahCount: number,
		fetchJson: FetchJson
	): Promise<TranslationVerse[] | TafsirVerse[]> {
		if (!desc.sourceResourceId) throw new SchemaError(`${desc.id}: missing sourceResourceId`);
		const url = desc.type === "translation"
			? `${QURAN_COM_API}/quran/translations/${desc.sourceResourceId}?chapter_number=${surah}&fields=verse_key`
			: `${QURAN_COM_API}/tafsirs/${desc.sourceResourceId}/by_chapter/${surah}`;
		const json = await fetchOrThrowNetwork(fetchJson, url);
		// Tafsir text is HTML while translations are plain-text records.
		return desc.type === "tafsir" ? normalizeQulTafsirRange(json) : normalizeQulRange(json);
	}
}

/** Provider-generic: iterate surahs, atomic-write, update index, report progress
 *  (spec §5.4). Mid-way failure leaves a valid partial install; re-running skips
 *  completed surahs. Fetches are strictly sequential (one in-flight at a time) —
 *  each surah's fetch + persist is awaited to completion before the next surah's
 *  fetch begins, since Registry.recordSurahInstalled does an unlocked
 *  read-modify-write on index.json and concurrent calls could lose updates.
 *  Only "translation" and "tafsir" are downloadable (§3) — scripts/metadata ship
 *  bundled and recitations are catalog-visible only, so any other requested type
 *  is refused up front with a typed error rather than silently attempted. */
export async function downloadResource(
	desc: ResourceDescriptor,
	source: DownloadSource,
	deps: { fetchJson: FetchJson; store: DataStore; registry: Registry },
	onProgress?: (p: DownloadProgress) => void,
	signal?: AbortSignal,
	options: DownloadOptions = {},
): Promise<void> {
	if (desc.type !== "translation" && desc.type !== "tafsir") {
		throw new NotFoundError(`${desc.id}: "${desc.type}" is not a downloadable resource type`);
	}
	const surahs = await deps.registry.core.getSurahs();
	const category = categoryForType(desc.type);
	const total = surahs.length;
	const bulk = source.fetchAllSurahs
		? await source.fetchAllSurahs(desc, deps.fetchJson)
		: undefined;
	let done = 0;
	for (const surah of surahs) {
		if (signal?.aborted) return;
		if (!options.replaceExisting && await deps.registry.isSurahInstalled(desc.id, surah.number)) {
			done++;
			onProgress?.({ surahsDone: done, surahsTotal: total });
			continue;
		}
		const verses = bulk?.get(surah.number)
			?? await source.fetchSurah(desc, surah.number, surah.ayahCount, deps.fetchJson);
		await deps.store.writeSurahFile(category, desc.id, surah.number, verses);
		if (!options.replaceExisting) {
			await deps.registry.recordSurahInstalled(desc, surah.number);
		}
		done++;
		onProgress?.({ surahsDone: done, surahsTotal: total });
	}
	if (options.replaceExisting && !signal?.aborted) {
		await deps.registry.recordResourceInstalled(desc, surahs.map((surah) => surah.number));
	}
}

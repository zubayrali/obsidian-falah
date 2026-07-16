// DownloadSource adapters + provider-generic pipeline (spec §5.4). Each adapter
// knows one provider's shape; downloadResource is provider-generic.

import { DataError, NetworkError, NotFoundError, SchemaError } from "./schema";
import type { DownloadSourceId, ResourceDescriptor, ResourceType, TafsirVerse, TranslationVerse } from "./schema";
import {
	normalizeAlQuranAyahs,
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
}

const QUL_BASE = "https://qul.tarteel.ai/api/v1";

export class QulSource implements DownloadSource {
	readonly id: DownloadSourceId = "qul";
	constructor(private fetchJsonForCatalog: FetchJson) {}

	async listCatalog(type: ResourceType): Promise<ResourceDescriptor[]> {
		if (type !== "translation" && type !== "tafsir") return [];
		const path = type === "translation" ? "translations" : "tafsirs";
		return normalizeQulCatalog(
			await fetchOrThrowNetwork(this.fetchJsonForCatalog, `${QUL_BASE}/resources/${path}`),
			type
		);
	}

	async fetchSurah(
		desc: ResourceDescriptor,
		surah: number,
		ayahCount: number,
		fetchJson: FetchJson
	): Promise<TranslationVerse[] | TafsirVerse[]> {
		if (!desc.sourceResourceId) throw new SchemaError(`${desc.id}: missing sourceResourceId`);
		const path = desc.type === "translation" ? "translations" : "tafsirs";
		const url = `${QUL_BASE}/${path}/${desc.sourceResourceId}/by_range?from=${surah}:1&to=${surah}:${ayahCount}`;
		const json = await fetchOrThrowNetwork(fetchJson, url);
		// The tafsir endpoint returns a different shape ({tafsirs:[{verses,text:HTML}]})
		// than translations ({translations:[{verse_key,text}]}), so normalize by type.
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
	signal?: AbortSignal
): Promise<void> {
	if (desc.type !== "translation" && desc.type !== "tafsir") {
		throw new NotFoundError(`${desc.id}: "${desc.type}" is not a downloadable resource type`);
	}
	const surahs = await deps.registry.core.getSurahs();
	const category = categoryForType(desc.type);
	const total = surahs.length;
	let done = 0;
	for (const surah of surahs) {
		if (signal?.aborted) return;
		if (await deps.registry.isSurahInstalled(desc.id, surah.number)) {
			done++;
			onProgress?.({ surahsDone: done, surahsTotal: total });
			continue;
		}
		const verses = await source.fetchSurah(desc, surah.number, surah.ayahCount, deps.fetchJson);
		await deps.store.writeSurahFile(category, desc.id, surah.number, verses);
		await deps.registry.recordSurahInstalled(desc, surah.number);
		done++;
		onProgress?.({ surahsDone: done, surahsTotal: total });
	}
}

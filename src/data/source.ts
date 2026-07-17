// The ContentSource seam (spec §5.1): the one interface feature code depends on.

import type { IslamicReference } from "../ref";
import { parseAyahKey, toAyahKeys, toUri } from "../ref";
import { quranExternalUrl, errMsg } from "../providers";
import type { QuranSearchResult, HadithSearchResult, QuranProvider, HadithProvider } from "../providers";
import { DataError, NetworkError, NotFoundError, NotInstalledError, SchemaError, StorageError } from "./schema";
import type { ArabicScript, Ayah, AyahKey, ReferenceContent, ResourceDescriptor, Surah, TafsirVerse, TranslationVerse, VerseContent } from "./schema";
import { CORE_CLEARQURAN_ID } from "./core";
import type { DataStore } from "./store";
import type { Registry } from "./registry";

export interface ContentPrefs {
	script: ArabicScript;
	translationId?: string;
	tafsirId?: string;
}

export interface ContentSource {
	readonly id: string;
	supports(ref: IslamicReference): boolean;
	getContent(ref: IslamicReference, prefs: ContentPrefs): Promise<ReferenceContent>;
}

export interface ReadingAyah {
	ayah: number;
	ayahKey: AyahKey;
	arabic: string;
	translation?: string;
	tafsir?: string;
}

export interface SurahReading {
	surah: Surah;
	/** A standalone Bismillah header is shown for every surah except 1 (where it
	 *  is ayah 1) and 9 (which has none). */
	showBismillah: boolean;
	translationName?: string;
	tafsirName?: string;
	ayahs: ReadingAyah[];
}

/** Closes the "every data-layer failure is a typed error" constraint at this
 *  seam (user decision, spec §5.1/§9): store/registry/download intentionally
 *  let rare raw OS/disk exceptions (disk-full, permission-denied) propagate
 *  unwrapped, so every *public* method a concrete source exposes to Task 9's
 *  feature code wraps its body in this — an error that's already a `DataError`
 *  (NotInstalledError/SchemaError/NetworkError/NotFoundError/…) is re-thrown
 *  unchanged; anything else becomes a `StorageError` carrying the original as
 *  `cause`. Applied to `QuranDataSource` and `LiveApiSource` (the two sources
 *  that actually touch disk/network) — deliberately NOT to `SourceChain`,
 *  which must transparently relay whatever its (possibly test-double) sources
 *  threw, per its own fallback/rethrow contract. */
async function withStorageBoundary<T>(context: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof DataError) throw e;
		throw new StorageError(context, { cause: e });
	}
}

/** Reads only local data — the bundled core (via registry.core) and downloaded/
 *  imported resources from the store; no network I/O (spec §5.1). */
export class QuranDataSource implements ContentSource {
	readonly id = "local";

	constructor(private store: DataStore, private registry: Registry) {}

	supports(ref: IslamicReference): boolean {
		return ref.kind === "quran";
	}

	async getSurah(n: number): Promise<Surah> {
		return withStorageBoundary(`QuranDataSource.getSurah(${n})`, async () => {
			const surahs = await this.registry.core.getSurahs();
			const found = surahs.find((s) => s.number === n);
			if (!found) throw new NotFoundError(`Surah ${n} does not exist`);
			return found;
		});
	}

	/** `script` doubles as the store resource id for any non-bundled script — no
	 *  other scripts ship in A, but the seam supports one arriving later without
	 *  a schema change. */
	async getVerse(key: AyahKey, script: ArabicScript): Promise<Ayah> {
		return withStorageBoundary(`QuranDataSource.getVerse(${key}, ${script})`, async () => {
			const parsed = parseAyahKey(key);
			if (!parsed) throw new NotFoundError(`Malformed ayah key "${key}"`);
			// `ArabicScript`'s open-string-union arm (`string & {}`) isn't disjoint from
			// its literal members from the type checker's view, so the equality check
			// above doesn't narrow `script` on its own — the cast just documents what
			// the runtime check already guarantees.
			const all =
				script === "uthmani" || script === "indopak"
					? await this.registry.core.getScript(script as "uthmani" | "indopak")
					: await this.store.loadSurahFile<Ayah[]>("quran", script, parsed.surah);
			const found = all.find((a) => a.ayahKey === key);
			if (!found) throw new NotFoundError(`${key} not found in ${script}`);
			return found;
		});
	}

	async getRange(from: AyahKey, to: AyahKey, script: ArabicScript): Promise<Ayah[]> {
		return withStorageBoundary(`QuranDataSource.getRange(${from}-${to}, ${script})`, async () => {
			const f = parseAyahKey(from);
			const t = parseAyahKey(to);
			if (!f || !t) throw new NotFoundError(`Malformed ayah key range "${from}"-"${to}"`);
			if (f.surah !== t.surah) throw new NotFoundError("Cross-surah ranges are not supported");
			const surah = await this.getSurah(f.surah);
			if (t.ayah > surah.ayahCount) {
				throw new NotFoundError(`${t.surah}:${t.ayah} exceeds surah ${t.surah}'s ${surah.ayahCount} ayahs`);
			}
			const out: Ayah[] = [];
			for (let a = f.ayah; a <= t.ayah; a++) out.push(await this.getVerse(`${f.surah}:${a}`, script));
			return out;
		});
	}

	async getTranslation(resourceId: string, from: AyahKey, to: AyahKey): Promise<TranslationVerse[]> {
		return withStorageBoundary(`QuranDataSource.getTranslation(${resourceId}, ${from}-${to})`, async () => {
			const f = parseAyahKey(from);
			const t = parseAyahKey(to);
			if (!f || !t || f.surah !== t.surah) {
				throw new NotFoundError(`Malformed or cross-surah translation range "${from}"-"${to}"`);
			}
			const verses =
				resourceId === CORE_CLEARQURAN_ID
					? await this.registry.core.getClearQuranTranslation()
					: await this.store.loadSurahFile<TranslationVerse[]>("translations", resourceId, f.surah);
			const wanted = new Set(toAyahKeys({ kind: "quran", surah: f.surah, ayah: f.ayah, toAyah: t.ayah }));
			const out = verses.filter((v) => wanted.has(v.ayahKey));
			if (out.length === 0) throw new NotFoundError(`${resourceId}: no verses in range ${from}-${to}`);
			return out;
		});
	}

	async getTafsir(resourceId: string, from: AyahKey, to: AyahKey): Promise<TafsirVerse[]> {
		return withStorageBoundary(`QuranDataSource.getTafsir(${resourceId}, ${from}-${to})`, async () => {
			const f = parseAyahKey(from);
			const t = parseAyahKey(to);
			if (!f || !t || f.surah !== t.surah) {
				throw new NotFoundError(`Malformed or cross-surah tafsir range "${from}"-"${to}"`);
			}
			const verses = await this.store.loadSurahFile<TafsirVerse[]>("tafsirs", resourceId, f.surah);
			const wanted = new Set(toAyahKeys({ kind: "quran", surah: f.surah, ayah: f.ayah, toAyah: t.ayah }));
			const out = verses.filter((v) => wanted.has(v.ayahKey));
			if (out.length === 0) throw new NotFoundError(`${resourceId}: no verses in range ${from}-${to}`);
			return out;
		});
	}

	async listResources(): Promise<ResourceDescriptor[]> {
		return withStorageBoundary("QuranDataSource.listResources()", () => this.registry.listResources());
	}

	/** On-demand tafsir for a single verse, group-aware (a tafsir block stored with
	 *  `ayahKeys` spanning several ayahs is matched for any covered ayah — unlike
	 *  getTafsir which keys off the block's first ayahKey only). Degrades to
	 *  undefined when the tafsir isn't installed or the verse isn't covered. */
	async getVerseTafsir(
		tafsirId: string,
		surah: number,
		ayah: number
	): Promise<{ name?: string; text: string } | undefined> {
		return withStorageBoundary(`QuranDataSource.getVerseTafsir(${tafsirId}, ${surah}:${ayah})`, async () => {
			const key = `${surah}:${ayah}`;
			let verses: TafsirVerse[];
			try {
				verses = await this.store.loadSurahFile<TafsirVerse[]>("tafsirs", tafsirId, surah);
			} catch (e) {
				if (
					e instanceof NotInstalledError ||
					e instanceof NotFoundError ||
					e instanceof SchemaError ||
					e instanceof StorageError
				) {
					return undefined;
				}
				throw e;
			}
			const entry = verses.find((v) => (v.ayahKeys ? v.ayahKeys.includes(key) : v.ayahKey === key));
			if (!entry) return undefined;
			const name = (await this.listResources()).find((r) => r.id === tafsirId)?.name;
			return { name, text: entry.text };
		});
	}

	/** Whole-surah read model for the Reader (Phase 1): bundled Arabic + optional
	 *  installed translation + optional installed tafsir, merged per ayah, offline.
	 *  Optional extras degrade to empty on a missing/corrupt resource — same contract
	 *  as getContent. */
	async getSurahReading(n: number, prefs: ContentPrefs): Promise<SurahReading> {
		return withStorageBoundary(`QuranDataSource.getSurahReading(${n})`, async () => {
			const surah = await this.getSurah(n);
			const from = `${n}:1`;
			const to = `${n}:${surah.ayahCount}`;
			const arabicAyahs = await this.getRange(from, to, prefs.script);

			const degradable = (e: unknown) =>
				e instanceof NotInstalledError ||
				e instanceof NotFoundError ||
				e instanceof SchemaError ||
				e instanceof StorageError;

			const translations = new Map<string, string>();
			let translationName: string | undefined;
			if (prefs.translationId) {
				try {
					const verses = await this.getTranslation(prefs.translationId, from, to);
					for (const v of verses) translations.set(v.ayahKey, v.text);
					translationName = (await this.listResources()).find((r) => r.id === prefs.translationId)?.name;
				} catch (e) {
					if (!degradable(e)) throw e;
				}
			}

			const tafsirs = new Map<string, string>();
			let tafsirName: string | undefined;
			if (prefs.tafsirId) {
				try {
					const verses = await this.getTafsir(prefs.tafsirId, from, to);
					for (const v of verses) {
						const keys = v.ayahKeys && v.ayahKeys.length ? v.ayahKeys : [v.ayahKey];
						for (const k of keys) tafsirs.set(k, v.text);
					}
					tafsirName = (await this.listResources()).find((r) => r.id === prefs.tafsirId)?.name;
				} catch (e) {
					if (!degradable(e)) throw e;
				}
			}

			const ayahs: ReadingAyah[] = arabicAyahs.map((a) => ({
				ayah: a.ayah,
				ayahKey: a.ayahKey,
				arabic: a.text,
				translation: translations.get(a.ayahKey),
				tafsir: tafsirs.get(a.ayahKey),
			}));

			return { surah, showBismillah: n !== 1 && n !== 9, translationName, tafsirName, ayahs };
		});
	}

	async getContent(ref: IslamicReference, prefs: ContentPrefs): Promise<VerseContent> {
		return withStorageBoundary(`QuranDataSource.getContent(${JSON.stringify(ref)})`, async () => {
			if (ref.kind !== "quran") throw new NotFoundError("QuranDataSource only supports quran refs");
			const from = `${ref.surah}:${ref.ayah}`;
			const to = ref.toAyah !== undefined ? `${ref.surah}:${ref.toAyah}` : from;
			const ayahs = await this.getRange(from, to, prefs.script);

			let arabic = ayahs.map((a) => a.text).join(" ");
			if (ayahs.length === 1 && (ref.fromWord !== undefined || ref.toWord !== undefined)) {
				const words = arabic.split(/\s+/);
				const start = (ref.fromWord ?? 1) - 1;
				const end = ref.toWord ?? words.length;
				arabic = words.slice(start, end).join(" ");
				// Ellipsis only on the side actually truncated (spec's "…" markers indicate
				// a word-bounded slice, not the full ayah, on that specific edge).
				if (start > 0) arabic = `… ${arabic}`;
				if (end < words.length) arabic = `${arabic} …`;
			}

			const surah = await this.getSurah(ref.surah);

			let translation: string | undefined;
			let translationName: string | undefined;
			if (prefs.translationId) {
				try {
					const verses = await this.getTranslation(prefs.translationId, from, to);
					const numbered = verses.length > 1;
					// Number by each verse's OWN ayah key, not its position in the
					// (possibly gap-filtered) list — a translation missing an interior
					// ayah of the range must still number the present verses correctly
					// (Fix D).
					translation = verses
						.map((v) => (numbered ? `(${parseAyahKey(v.ayahKey)?.ayah ?? ""}) ` : "") + v.text)
						.join(" ")
						.trim();
					translationName = (await this.listResources()).find((r) => r.id === prefs.translationId)?.name;
				} catch (e) {
					// Optional extras degrade gracefully (§5.1, §11): a missing resource
					// (NotInstalledError/NotFoundError) OR a corrupt/unreadable installed
					// file (SchemaError/StorageError) leaves translation undefined rather
					// than aborting the verse. Anything else is unexpected — rethrow.
					if (!(e instanceof NotInstalledError || e instanceof NotFoundError || e instanceof SchemaError || e instanceof StorageError)) throw e;
				}
			}

			let tafsir: string | undefined;
			if (prefs.tafsirId) {
				try {
					const verses = await this.getTafsir(prefs.tafsirId, from, to);
					tafsir = verses.map((v) => v.text).join("\n\n").trim() || undefined;
				} catch (e) {
					// Same degrade-not-abort contract as translation extras (§11).
					if (!(e instanceof NotInstalledError || e instanceof NotFoundError || e instanceof SchemaError || e instanceof StorageError)) throw e;
				}
			}

			return {
				ref,
				arabic,
				translation: translation || undefined,
				translationName,
				tafsir,
				surahNameArabic: surah.nameArabic,
				surahNameEnglish: surah.nameEnglish,
				ayahCount: surah.ayahCount,
				externalUrl: quranExternalUrl(ref),
			};
		});
	}
}

/** Ordered composition — what main.ts hands to feature code (spec §5.1). */
export class SourceChain implements ContentSource {
	readonly id = "chain";

	constructor(private sources: ContentSource[]) {}

	supports(ref: IslamicReference): boolean {
		return this.sources.some((s) => s.supports(ref));
	}

	async getContent(ref: IslamicReference, prefs: ContentPrefs): Promise<ReferenceContent> {
		let firstError: unknown;
		for (const source of this.sources) {
			if (!source.supports(ref)) continue;
			try {
				return await source.getContent(ref, prefs);
			} catch (e) {
				const recognized = e instanceof NotInstalledError || e instanceof NetworkError || e instanceof NotFoundError;
				// An unrecognized (raw) error stops the chain immediately only while
				// we have nothing better to report yet. Once an earlier source has
				// already produced a typed failure, a later source's raw error is
				// less informative than that — keep the first typed error instead of
				// surfacing whatever broke afterward.
				if (!recognized && firstError === undefined) throw e;
				firstError ??= e;
			}
		}
		// eslint-disable-next-line @typescript-eslint/only-throw-error -- firstError is a caught error being re-thrown; rethrowing it as-is preserves the original type and stack, which wrapping it in a new Error would discard.
		if (firstError !== undefined) throw firstError;
		throw new NotFoundError(`No source supports ${ref.kind} references`);
	}
}

export interface CacheEntry {
	t: number;
	provider: string;
	v: unknown;
}

// ponytail: whole cache serialized into plugin data.json; fine for hundreds of refs,
// move to IndexedDB if it ever gets slow
export class RefCache {
	constructor(
		public data: Record<string, CacheEntry>,
		private persist: () => void
	) {}

	get<T>(key: string): T | undefined {
		return this.data[key]?.v as T | undefined;
	}

	set(key: string, provider: string, value: unknown): void {
		this.data[key] = { t: Date.now(), provider, v: value };
		this.persist();
	}

	deletePrefix(prefix: string): void {
		for (const k of Object.keys(this.data)) {
			if (k.startsWith(prefix)) delete this.data[k];
		}
		this.persist();
	}
}

/** The existing live APIs, kept as the runtime fallback and the sole hadith path
 *  (spec §5.1). Wraps AlQuranCloudProvider + HadithCdnProvider; still honors the
 *  legacy translationEdition/tafsirEdition settings (a different id namespace from
 *  our resource ids, fallback-only). */
export class LiveApiSource implements ContentSource {
	readonly id = "live-api";

	constructor(
		private quran: QuranProvider,
		private hadith: HadithProvider,
		private cache: RefCache,
		private editions: () => { translation: string; tafsir: string }
	) {}

	supports(_ref: IslamicReference): boolean {
		return true;
	}

	async getContent(ref: IslamicReference, _prefs: ContentPrefs): Promise<ReferenceContent> {
		return withStorageBoundary(`LiveApiSource.getContent(${JSON.stringify(ref)})`, async () => {
			const key = this.cacheKey(ref);
			const cached = this.cache.get<ReferenceContent>(key);
			if (cached) return cached;
			let content: ReferenceContent;
			try {
				content = ref.kind === "quran" ? await this.quran.getVerse(ref) : await this.hadith.getHadith(ref);
			} catch (e) {
				throw new NetworkError(errMsg(e));
			}
			this.cache.set(key, this.id, content);
			return content;
		});
	}

	private cacheKey(ref: IslamicReference): string {
		const { translation, tafsir } = this.editions();
		return `${toUri(ref)}|${translation}|${tafsir}`;
	}

	searchQuran(query: string): Promise<QuranSearchResult[]> {
		return withStorageBoundary(`LiveApiSource.searchQuran(${query})`, () => this.quran.search(query));
	}

	searchHadith(query: string): Promise<HadithSearchResult[]> {
		return withStorageBoundary(`LiveApiSource.searchHadith(${query})`, () => this.hadith.search(query));
	}
}

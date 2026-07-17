// External API/pack shapes → our canonical schema (spec §5.5). Pure functions;
// every malformed input throws SchemaError, never a raw parse exception.

import { parseAyahKey } from "../ref";
import { SchemaError } from "./schema";
import type { Ayah, ResourceDescriptor, ResourceType, Surah, TafsirVerse, TranslationVerse } from "./schema";

// ISO 639-1 for the languages this plugin is likely to see; falls back to the
// source's own lowercased language name otherwise (spec §4: "where possible").
const LANGUAGE_ISO: Record<string, string> = {
	english: "en",
	arabic: "ar",
	french: "fr",
	urdu: "ur",
	turkish: "tr",
	indonesian: "id",
	bengali: "bn",
	spanish: "es",
	german: "de",
	russian: "ru",
	persian: "fa",
	malay: "ms",
};

function languageToIso(name: string): string {
	return LANGUAGE_ISO[name.trim().toLowerCase()] ?? name.trim().toLowerCase();
}

interface FawazEditionMeta {
	name?: unknown;
	author?: unknown;
	language?: unknown;
}

/** editions.json — keyed by edition slug, e.g. "eng_ahmedali". */
export function normalizeFawazEditions(json: unknown): ResourceDescriptor[] {
	if (typeof json !== "object" || json === null) {
		throw new SchemaError("fawazahmed0 editions: expected an object");
	}
	const out: ResourceDescriptor[] = [];
	for (const [key, meta] of Object.entries(json as Record<string, unknown>)) {
		const m = meta as FawazEditionMeta;
		if (typeof m?.name !== "string" || typeof m?.language !== "string") {
			throw new SchemaError(`fawazahmed0 editions: malformed entry "${key}"`);
		}
		out.push({
			id: `fawazahmed0-${m.name}`,
			type: "translation",
			name: typeof m.author === "string" && m.author ? m.author : m.name,
			language: languageToIso(m.language),
			tier: "downloaded",
			source: "fawazahmed0",
			sourceResourceId: m.name,
			license: "Unlicense (public domain)",
		});
	}
	return out;
}

/** One resource's whole-Quran file sliced to one chapter:
 *  editions/<slug>/<n>.json → { "chapter": [{ chapter, verse, text }] }. */
export function normalizeFawazSurah(json: unknown, surah: number): TranslationVerse[] {
	const body = json as { chapter?: unknown };
	if (!Array.isArray(body?.chapter)) {
		throw new SchemaError('fawazahmed0 surah file: missing "chapter" array');
	}
	return body.chapter.map((v, i) => {
		if (typeof v !== "object" || v === null) {
			throw new SchemaError(
				`fawazahmed0 surah file: expected object at index ${i}, got ${v === null ? "null" : typeof v}`
			);
		}
		const row = v as { chapter?: unknown; verse?: unknown; text?: unknown };
		if (row.chapter !== surah || typeof row.verse !== "number" || typeof row.text !== "string") {
			throw new SchemaError(`fawazahmed0 surah file: malformed verse at index ${i}`);
		}
		return { ayahKey: `${surah}:${row.verse}`, text: row.text };
	});
}

interface AlQuranEditionMeta {
	identifier?: unknown;
	language?: unknown;
	englishName?: unknown;
	type?: unknown;
}

export function normalizeAlQuranEditions(json: unknown): ResourceDescriptor[] {
	const body = json as { code?: unknown; data?: unknown };
	if (body?.code !== 200 || !Array.isArray(body.data)) {
		throw new SchemaError("AlQuran.cloud editions: unexpected response shape");
	}
	const out: ResourceDescriptor[] = [];
	for (const e of body.data as AlQuranEditionMeta[]) {
		if (typeof e !== "object" || e === null) {
			throw new SchemaError(`AlQuran.cloud editions: expected object, got ${e === null ? "null" : typeof e}`);
		}
		if (e.type !== "translation" && e.type !== "tafsir") continue;
		if (typeof e.identifier !== "string" || typeof e.englishName !== "string") {
			throw new SchemaError("AlQuran.cloud editions: malformed entry");
		}
		out.push({
			id: `alquran-cloud-${e.identifier}`,
			type: e.type,
			name: e.englishName,
			language: typeof e.language === "string" ? e.language : "en",
			tier: "downloaded",
			source: "alquran-cloud",
			sourceResourceId: e.identifier,
			license: "AlQuran.cloud open edition",
		});
	}
	return out;
}

export function normalizeAlQuranAyahs(json: unknown, surah: number): TranslationVerse[] {
	const body = json as { code?: unknown; data?: { number?: unknown; ayahs?: unknown } };
	if (body?.code !== 200 || !Array.isArray(body.data?.ayahs)) {
		throw new SchemaError("AlQuran.cloud surah response: unexpected shape");
	}
	if (body.data.number !== surah) {
		throw new SchemaError(
			`AlQuran.cloud surah response: expected surah ${surah}, got ${String(body.data.number)}`
		);
	}
	return (body.data.ayahs as Array<{ numberInSurah?: unknown; text?: unknown }>).map((a, i) => {
		if (typeof a !== "object" || a === null) {
			throw new SchemaError(
				`AlQuran.cloud surah response: expected object at index ${i}, got ${a === null ? "null" : typeof a}`
			);
		}
		if (typeof a.numberInSurah !== "number" || typeof a.text !== "string") {
			throw new SchemaError(`AlQuran.cloud surah response: malformed ayah at index ${i}`);
		}
		return { ayahKey: `${surah}:${a.numberInSurah}`, text: a.text };
	});
}

interface QulResourceMeta {
	id?: unknown;
	name?: unknown;
	language?: unknown;
	language_name?: unknown;
}

export function normalizeQulCatalog(
	json: unknown,
	type: "translation" | "tafsir"
): ResourceDescriptor[] {
	const key = type === "translation" ? "translations" : "tafsirs";
	const body = json as Record<string, unknown>;
	if (!Array.isArray(body?.[key])) {
		throw new SchemaError(`QUL catalog: missing "${key}" array`);
	}
	return (body[key] as QulResourceMeta[]).map((r, i) => {
		if (typeof r !== "object" || r === null) {
			throw new SchemaError(
				`QUL catalog: expected object at index ${i}, got ${r === null ? "null" : typeof r}`
			);
		}
		if (typeof r.id !== "number" || typeof r.name !== "string") {
			throw new SchemaError("QUL catalog: malformed resource entry");
		}
		// QUL is inconsistent across resource types: translations carry `language`
		// ("english"), tafsirs leave that null and use `language_name` ("arabic").
		// Read whichever is present so tafsirs aren't all mislabeled as the default.
		const langRaw =
			typeof r.language === "string"
				? r.language
				: typeof r.language_name === "string"
					? r.language_name
					: "english";
		return {
			id: `qul-${r.id}`,
			type,
			name: r.name,
			language: languageToIso(langRaw),
			tier: "downloaded",
			source: "qul",
			sourceResourceId: String(r.id),
			license: "QUL public API",
		};
	});
}

export function normalizeQulRange(json: unknown): TranslationVerse[] {
	const body = json as { translations?: unknown };
	if (!Array.isArray(body?.translations)) {
		throw new SchemaError('QUL by_range: missing "translations" array');
	}
	return (body.translations as Array<{ verse_key?: unknown; text?: unknown }>).map((t, i) => {
		if (typeof t !== "object" || t === null) {
			throw new SchemaError(
				`QUL by_range: expected object at index ${i}, got ${t === null ? "null" : typeof t}`
			);
		}
		if (typeof t.verse_key !== "string" || typeof t.text !== "string") {
			throw new SchemaError(`QUL by_range: malformed entry at index ${i}`);
		}
		return { ayahKey: t.verse_key, text: t.text };
	});
}

/** Decode the handful of HTML entities QUL tafsir text actually uses. `&amp;` is
 *  decoded last so an already-encoded entity like `&amp;lt;` is not turned into a tag. */
function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0*39;|&apos;|&lsquo;|&rsquo;/g, "'")
		.replace(/&ldquo;|&rdquo;/g, '"')
		.replace(/&mdash;/g, "—")
		.replace(/&ndash;/g, "–")
		.replace(/&hellip;/g, "…")
		.replace(/&#x([0-9a-fA-F]+);/g, (_: string, h: string) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_: string, n: string) => String.fromCodePoint(Number(n)))
		.replace(/&amp;/g, "&");
}

/** QUL tafsir text is HTML. We render tafsir as plain text (detail modal + reader),
 *  so flatten it: block-closing tags become newlines, all other tags are dropped,
 *  entities decoded, runaway blank lines collapsed. */
export function stripHtml(html: string): string {
	const withBreaks = html
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\/\s*(p|div|h[1-6]|li|blockquote|tr|ul|ol)\s*>/gi, "\n")
		.replace(/<[^>]+>/g, "");
	return decodeEntities(withBreaks)
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** QUL `tafsirs/{id}/by_range` differs from the translations endpoint: the array is
 *  keyed `tafsirs`, each entry carries a `verses` array (one tafsir block can span
 *  several ayahs → grouped) and HTML `text`. Map to TafsirVerse, stripping HTML. */
export function normalizeQulTafsirRange(json: unknown): TafsirVerse[] {
	const body = json as { tafsirs?: unknown };
	if (!Array.isArray(body?.tafsirs)) {
		throw new SchemaError('QUL tafsir by_range: missing "tafsirs" array');
	}
	return (body.tafsirs as Array<{ verses?: unknown; text?: unknown }>).map((t, i) => {
		if (typeof t !== "object" || t === null) {
			throw new SchemaError(
				`QUL tafsir by_range: expected object at index ${i}, got ${t === null ? "null" : typeof t}`
			);
		}
		if (typeof t.text !== "string" || !Array.isArray(t.verses)) {
			throw new SchemaError(`QUL tafsir by_range: malformed entry at index ${i}`);
		}
		const verses = (t.verses as unknown[]).filter((v): v is string => typeof v === "string");
		if (verses.length === 0) {
			throw new SchemaError(`QUL tafsir by_range: entry ${i} has no valid verse keys`);
		}
		const out: TafsirVerse = { ayahKey: verses[0], text: stripHtml(t.text) };
		if (verses.length > 1) out.ayahKeys = verses;
		return out;
	});
}

interface ImportPackJson {
	id?: unknown;
	type?: unknown;
	name?: unknown;
	language?: unknown;
	license?: unknown;
	verses?: unknown;
}

export function normalizePack(
	json: unknown,
	declaredType: ResourceType
): { descriptor: ResourceDescriptor; bySurah: Map<number, TranslationVerse[]> } {
	const body = json as ImportPackJson;
	if (
		typeof body?.id !== "string" ||
		typeof body.name !== "string" ||
		typeof body.language !== "string" ||
		!Array.isArray(body.verses)
	) {
		throw new SchemaError("import pack: missing required fields (id, name, language, verses)");
	}
	if (body.type !== declaredType) {
		throw new SchemaError(
			`import pack: declared type "${declaredType}" does not match pack type "${String(body.type)}"`
		);
	}
	// Packs are shareable, so the user-supplied id becomes a directory segment on
	// disk (store.surahPath). Reject anything that could escape the plugin dir or
	// break the filesystem-safe id contract: path separators, "..", a leading dot
	// (hidden files / traversal), control characters, or the reserved ":" (Fix B).
	if (
		body.id.length === 0 ||
		/[/\\]/.test(body.id) ||
		body.id.includes("..") ||
		body.id.startsWith(".") ||
		body.id.includes(":") ||
		// eslint-disable-next-line no-control-regex -- matching control chars is the point: they must be rejected from an id that becomes a file path.
		/[\x00-\x1f\x7f]/.test(body.id)
	) {
		throw new SchemaError(`import pack: unsafe id "${body.id}" (path separators, "..", leading ".", ":" and control chars are not allowed)`);
	}
	const bySurah = new Map<number, TranslationVerse[]>();
	body.verses.forEach((v, i) => {
		if (typeof v !== "object" || v === null) {
			throw new SchemaError(
				`import pack: expected object at index ${i}, got ${v === null ? "null" : typeof v}`
			);
		}
		const row = v as { ayahKey?: unknown; text?: unknown };
		const parsed = typeof row.ayahKey === "string" ? parseAyahKey(row.ayahKey) : null;
		if (!parsed || typeof row.text !== "string") {
			throw new SchemaError(`import pack: malformed verse at index ${i}`);
		}
		const list = bySurah.get(parsed.surah) ?? [];
		list.push({ ayahKey: row.ayahKey as string, text: row.text });
		bySurah.set(parsed.surah, list);
	});
	return {
		descriptor: {
			id: `import-${body.id}`,
			type: declaredType,
			name: body.name,
			language: body.language,
			tier: "user-import",
			license: typeof body.license === "string" ? body.license : undefined,
		},
		bySurah,
	};
}

export interface RawScriptAyah {
	surah: number;
	ayah: number;
	text: string;
}

export interface CoreBuildInputs {
	uthmani: RawScriptAyah[];
	indopak: RawScriptAyah[];
	clearQuran: TranslationVerse[];
	surahs: Surah[];
}

export interface CoreBuildOutput {
	uthmani: Ayah[];
	indopak: Ayah[];
	clearquran: TranslationVerse[];
	surahs: Surah[];
}

function toCoreAyahs(raw: RawScriptAyah[]): Ayah[] {
	return raw.map((r) => ({ ayahKey: `${r.surah}:${r.ayah}`, surah: r.surah, ayah: r.ayah, text: r.text }));
}

/** Dev-time only (spec §13): assembles the bundled-core JSON from openly-licensed
 *  source datasets. Never runs in the shipped plugin. */
export function normalizeToCore(inputs: CoreBuildInputs): CoreBuildOutput {
	if (inputs.uthmani.length !== 6236 || inputs.indopak.length !== 6236) {
		throw new SchemaError(
			`bundled-core build: expected 6236 ayahs per script, got ${inputs.uthmani.length} uthmani / ${inputs.indopak.length} indopak`
		);
	}
	if (inputs.surahs.length !== 114) {
		throw new SchemaError(`bundled-core build: expected 114 surahs, got ${inputs.surahs.length}`);
	}
	return {
		uthmani: toCoreAyahs(inputs.uthmani),
		indopak: toCoreAyahs(inputs.indopak),
		clearquran: inputs.clearQuran,
		surahs: inputs.surahs,
	};
}

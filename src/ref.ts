// Canonical Islamic reference model, parser, and Markdown formatter.
// Pure functions, no Obsidian imports, so vitest can run this file directly.

export interface QuranRef {
	kind: "quran";
	surah: number;
	ayah: number;
	toAyah?: number;
	fromWord?: number;
	toWord?: number;
}

export interface HadithRef {
	kind: "hadith";
	collection: string;
	number: string;
}

export type IslamicReference = QuranRef | HadithRef;

export const HADITH_COLLECTION_NAMES: Record<string, string> = {
	bukhari: "Bukhari",
	muslim: "Muslim",
	abudawud: "Abu Dawud",
	tirmidhi: "Tirmidhi",
	nasai: "an-Nasa'i",
	ibnmajah: "Ibn Majah",
	malik: "Malik",
	nawawi: "Nawawi",
	qudsi: "Qudsi",
	dehlawi: "Dehlawi",
};

function int(s: string): number | null {
	return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

// ponytail: global 286 cap instead of a per-surah ayah-count table; the provider 404s the rest
function validQuran(surah: number, ayah: number, toAyah?: number): boolean {
	if (surah < 1 || surah > 114 || ayah < 1 || ayah > 286) return false;
	if (toAyah !== undefined && (toAyah < ayah || toAyah > 286)) return false;
	return true;
}

/** "2:255" for the ref's starting ayah. */
export function toAyahKey(ref: QuranRef): string {
	return `${ref.surah}:${ref.ayah}`;
}

/** Every key in the ref's range: "2:255", "2:256", "2:257". */
export function toAyahKeys(ref: QuranRef): string[] {
	const last = ref.toAyah ?? ref.ayah;
	const keys: string[] = [];
	for (let a = ref.ayah; a <= last; a++) keys.push(`${ref.surah}:${a}`);
	return keys;
}

/** Parse "2:255" → { surah: 2, ayah: 255 } with parseShorthand's bounds; null on malformed. */
export function parseAyahKey(key: string): { surah: number; ayah: number } | null {
	const m = /^(\d{1,3}):(\d{1,3})$/.exec(key.trim());
	if (!m) return null;
	const surah = parseInt(m[1], 10);
	const ayah = parseInt(m[2], 10);
	if (!validQuran(surah, ayah)) return null;
	return { surah, ayah };
}

/** Parse a canonical `falah://` URI. Returns null on anything malformed; never throws. */
export function parseRefUri(uri: string): IslamicReference | null {
	const m = /^falah:\/\/(quran|hadith)\/([^?#\s]+)(?:\?([^#\s]*))?$/.exec(uri.trim());
	if (!m) return null;
	const parts = m[2].split("/").filter(Boolean);
	if (parts.length !== 2) return null;

	if (m[1] === "quran") {
		const surah = int(parts[0]);
		const range = /^(\d+)(?:-(\d+))?$/.exec(parts[1]);
		if (surah === null || !range) return null;
		const ayah = parseInt(range[1], 10);
		const toAyah = range[2] ? parseInt(range[2], 10) : undefined;
		if (!validQuran(surah, ayah, toAyah)) return null;
		const ref: QuranRef = { kind: "quran", surah, ayah };
		if (toAyah !== undefined && toAyah !== ayah) ref.toAyah = toAyah;
		if (m[3]) {
			const q = new URLSearchParams(m[3]);
			const fromWord = q.get("fromWord");
			const toWord = q.get("toWord");
			if (fromWord !== null) {
				const n = int(fromWord);
				if (n === null || n < 1) return null;
				ref.fromWord = n;
			}
			if (toWord !== null) {
				const n = int(toWord);
				if (n === null || n < (ref.fromWord ?? 1)) return null;
				ref.toWord = n;
			}
		}
		return ref;
	}

	const collection = parts[0].toLowerCase();
	const number = parts[1].toLowerCase();
	if (!/^[a-z][a-z0-9_]*$/.test(collection) || !/^\d+[a-z]?$/.test(number)) return null;
	return { kind: "hadith", collection, number };
}

/** Parse user shorthand: `2:255`, `quran 2:255`, `2:255-257`, `bukhari:99`, `muslim 8a`. */
export function parseShorthand(input: string): IslamicReference | null {
	const s = input.trim().toLowerCase();
	const quran = /^(?:quran\s+)?(\d{1,3}):(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/.exec(s);
	if (quran) {
		const surah = parseInt(quran[1], 10);
		const ayah = parseInt(quran[2], 10);
		const toAyah = quran[3] ? parseInt(quran[3], 10) : undefined;
		if (!validQuran(surah, ayah, toAyah)) return null;
		const ref: QuranRef = { kind: "quran", surah, ayah };
		if (toAyah !== undefined && toAyah !== ayah) ref.toAyah = toAyah;
		return ref;
	}
	const hadith = /^([a-z][a-z0-9_]*)\s*[:\s]\s*(\d+[a-z]?)$/.exec(s);
	if (hadith && hadith[1] !== "quran") {
		return { kind: "hadith", collection: hadith[1], number: hadith[2] };
	}
	return null;
}

export function toUri(ref: IslamicReference): string {
	if (ref.kind === "hadith") return `falah://hadith/${ref.collection}/${ref.number}`;
	let uri = `falah://quran/${ref.surah}/${ref.ayah}`;
	if (ref.toAyah !== undefined) uri += `-${ref.toAyah}`;
	const q = new URLSearchParams();
	if (ref.fromWord !== undefined) q.set("fromWord", String(ref.fromWord));
	if (ref.toWord !== undefined) q.set("toWord", String(ref.toWord));
	const qs = q.toString();
	return qs ? `${uri}?${qs}` : uri;
}

export function toLabel(ref: IslamicReference): string {
	if (ref.kind === "quran") {
		return `Quran ${ref.surah}:${ref.ayah}${ref.toAyah !== undefined ? `-${ref.toAyah}` : ""}`;
	}
	const name =
		HADITH_COLLECTION_NAMES[ref.collection] ??
		ref.collection.charAt(0).toUpperCase() + ref.collection.slice(1);
	return `Hadith ${name} ${ref.number}`;
}

export function toMarkdownLink(ref: IslamicReference): string {
	return `[${toLabel(ref)}](${toUri(ref)})`;
}

export interface RenderedText {
	arabic?: string;
	translation?: string;
	attribution?: string;
}

const collapse = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

/** Callout block: canonical link in the title, optional cached text in the body. */
export function toCallout(ref: IslamicReference, text?: RenderedText): string {
	const lines = [`> [!${ref.kind}] ${toMarkdownLink(ref)}`];
	if (text?.arabic) lines.push(`> ${collapse(text.arabic)}`);
	if (text?.translation) lines.push(`> ${collapse(text.translation)}`);
	if (text?.attribution) lines.push(`> — ${collapse(text.attribution)}`);
	return lines.join("\n");
}

export interface FoundReference {
	index: number;
	match: string;
	label: string;
	uri: string;
	ref: IslamicReference;
}

/** Find all valid `[label](falah://...)` links in a text, with their offsets. */
export function findReferences(text: string): FoundReference[] {
	const out: FoundReference[] = [];
	const re = /\[([^\]\n]*)\]\((falah:\/\/[^\s)]+)\)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const ref = parseRefUri(m[2]);
		if (ref) out.push({ index: m.index, match: m[0], label: m[1], uri: m[2], ref });
	}
	return out;
}

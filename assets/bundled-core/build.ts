// Dev-time only (spec §3, §13): assembles assets/bundled-core/*.json from
// openly-licensed source datasets. Run once with `npm run build:core`; the
// shipped plugin never executes this file or contacts these endpoints.

import { writeFileSync } from "node:fs";
import { normalizeToCore } from "../../src/data/normalize";
import type { RawScriptAyah } from "../../src/data/normalize";
import type { Surah, TranslationVerse } from "../../src/data/schema";

const FAWAZ_QURAN_BASE = "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1";
const QUL_BASE = "https://qul.tarteel.ai/api/v1";
// The Clear Quran (Dr. Mustafa Khattab) — Tanzil/fawazahmed0 edition slug.
// QUL catalogs this same translation under numeric id 131 (spec §13's original
// source), but as of this build QUL's own `/translations/131/by_range` returns
// 404 for every range ("Translation resource with ID 131 not found") despite
// being listed in `/resources/translations` — verified live, not a local
// network issue (other QUL and fawazahmed0 endpoints used below work fine).
// This is the identical translation, hosted on the same CDN already used for
// the Arabic scripts, so it's used here instead of fabricating the text.
const CLEAR_QURAN_EDITION = "eng-mustafakhattaba";

async function fetchJson(url: string): Promise<unknown> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
	return res.json();
}

/** One fawazahmed0/Tanzil whole-Quran text file → flat per-ayah rows. */
async function fetchScript(edition: string): Promise<RawScriptAyah[]> {
	const json = (await fetchJson(`${FAWAZ_QURAN_BASE}/editions/${edition}.json`)) as {
		quran: Array<{ chapter: number; verse: number; text: string }>;
	};
	return json.quran.map((v) => ({ surah: v.chapter, ayah: v.verse, text: v.text }));
}

/** The Clear Quran, fetched whole-book from the fawazahmed0/Tanzil CDN (see
 *  CLEAR_QURAN_EDITION comment above for why this replaces QUL id 131). */
async function fetchClearQuran(): Promise<TranslationVerse[]> {
	const rows = await fetchScript(CLEAR_QURAN_EDITION);
	return rows.map((r) => ({ ayahKey: `${r.surah}:${r.ayah}`, text: r.text }));
}

/** QUL /chapters → our Surah[] metadata shape. */
async function fetchSurahMeta(): Promise<Surah[]> {
	const json = (await fetchJson(`${QUL_BASE}/chapters`)) as {
		chapters: Array<{
			id: number;
			name_arabic: string;
			name_simple: string;
			verses_count: number;
			revelation_place: string;
			translated_name: { name: string };
		}>;
	};
	return json.chapters.map((c) => ({
		number: c.id,
		nameArabic: c.name_arabic,
		nameEnglish: c.translated_name.name,
		nameTransliterated: c.name_simple,
		ayahCount: c.verses_count,
		revelationPlace: (c.revelation_place === "madinah" ? "madinah" : "makkah") as "makkah" | "madinah",
	}));
}

async function main(): Promise<void> {
	console.log("Fetching surah metadata from QUL /chapters …");
	const surahs = await fetchSurahMeta();

	console.log("Fetching Uthmani text (fawazahmed0/Tanzil ara-quranuthmanihaf) …");
	const uthmani = await fetchScript("ara-quranuthmanihaf");

	console.log("Fetching Indo-Pak text (fawazahmed0/Tanzil ara-quranindopak) …");
	const indopak = await fetchScript("ara-quranindopak");

	console.log(`Fetching The Clear Quran (fawazahmed0 edition ${CLEAR_QURAN_EDITION}) …`);
	const clearQuran = await fetchClearQuran();

	const core = normalizeToCore({ uthmani, indopak, clearQuran, surahs });

	writeFileSync("assets/bundled-core/uthmani.json", JSON.stringify(core.uthmani));
	writeFileSync("assets/bundled-core/indopak.json", JSON.stringify(core.indopak));
	writeFileSync("assets/bundled-core/clearquran.json", JSON.stringify(core.clearquran));
	writeFileSync("assets/bundled-core/surahs.json", JSON.stringify(core.surahs));

	console.log("Wrote assets/bundled-core/{uthmani,indopak,clearquran,surahs}.json");
}

void main();

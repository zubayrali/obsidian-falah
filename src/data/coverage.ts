import { SchemaError } from "./schema";
import type { TafsirVerse, TranslationVerse } from "./schema";

/** Count actual covered keys; grouped tafsir may cover more than its first verse. */
export function missingAyahCount(rows: (TranslationVerse | TafsirVerse)[], surah: number, ayahCount: number): number {
	const covered = new Set<string>();
	for (const row of rows) {
		if (!row.text.trim()) continue;
		const keys = "ayahKeys" in row && row.ayahKeys?.length ? row.ayahKeys : [row.ayahKey];
		for (const key of keys) {
			const match = /^(\d+):(\d+)$/.exec(key);
			if (!match || Number(match[1]) !== surah || Number(match[2]) < 1 || Number(match[2]) > ayahCount) throw new SchemaError(`Unexpected verse key ${key} in chapter ${surah}`);
			covered.add(key);
		}
	}
	if (!covered.size) throw new SchemaError(`Chapter ${surah} has no usable content`);
	return ayahCount - covered.size;
}

export function resourceMissingAyahs(meta?: Record<string, unknown>): number {
	const counts = meta?.missingAyahsBySurah;
	if (!counts || typeof counts !== "object") return 0;
	return Object.values(counts).reduce<number>((total, count: unknown) => total + (typeof count === "number" && count > 0 ? count : 0), 0);
}

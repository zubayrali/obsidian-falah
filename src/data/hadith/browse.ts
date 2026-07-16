// Pure in-memory filter for the browse-to-insert hadith picker. A numeric query
// matches by hadith-number prefix; anything else is a case-insensitive substring
// over translation/arabic. Capped at `limit` so a 7000-hadith collection renders
// cheaply.

import type { NormHadith } from "./schema";

export function filterHadiths(hadiths: NormHadith[], query: string, limit: number): NormHadith[] {
	const q = query.trim();
	if (!q) return hadiths.slice(0, limit);
	const out: NormHadith[] = [];
	if (/^\d+$/.test(q)) {
		for (const h of hadiths) {
			if (String(h.number).startsWith(q)) out.push(h);
			if (out.length >= limit) break;
		}
		return out;
	}
	const lower = q.toLowerCase();
	for (const h of hadiths) {
		if ((h.translation?.toLowerCase().includes(lower) ?? false) || (h.arabic?.includes(q) ?? false)) {
			out.push(h);
		}
		if (out.length >= limit) break;
	}
	return out;
}

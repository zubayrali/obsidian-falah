// Pure query resolver: a typed query → ranked navigation candidates. No
// "obsidian" import. Surah names/matching come from the passed core Surah table.
import type { Surah } from "../data/schema";
import type { QuranNav, NavPoint } from "./schema";

export interface NavCandidate {
	surah: number;
	ayah: number;
	label: string;
	sublabel?: string;
	kind: "ayah" | "surah" | "juz" | "hizb" | "rub" | "page" | "sajdah";
}

/** Common juz nicknames → juz number. */
const JUZ_ALIASES: Record<string, number> = { amma: 30, tabarak: 29 };

const ARABIC_DIACRITICS = /[ً-ْٰ]/g;
export function normalizeName(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "") // Latin diacritics
		.replace(ARABIC_DIACRITICS, "") // Arabic harakat
		.toLowerCase()
		.replace(/[^a-z0-9؀-ۿ]/g, ""); // drop spaces/hyphens/punct
}

const point = (arr: NavPoint[], n: number) => arr.find((p) => p.n === n);

export function resolveNav(query: string, surahs: Surah[], nav: QuranNav): NavCandidate[] {
	const q = query.trim();
	if (!q) return [];
	const out: NavCandidate[] = [];
	const surahLabel = (n: number) => surahs.find((s) => s.number === n)?.nameTransliterated ?? `Surah ${n}`;

	// 2:255
	const ref = /^(\d{1,3}):(\d{1,3})$/.exec(q);
	if (ref) {
		const surah = +ref[1], ayah = +ref[2];
		if (surah >= 1 && surah <= 114) return [{ surah, ayah, kind: "ayah", label: `${surahLabel(surah)} ${surah}:${ayah}` }];
	}

	// scheme keywords: juz/hizb/rub/page N (or juz <alias>)
	const kw = /^(juz|hizb|rub|page|p)\s+(\w+)$/i.exec(q);
	if (kw) {
		const scheme = kw[1].toLowerCase() === "p" ? "page" : kw[1].toLowerCase();
		const raw = kw[2].toLowerCase();
		const num = /^\d+$/.test(raw) ? +raw : JUZ_ALIASES[raw];
		const arr = scheme === "page" ? nav.pages : scheme === "juz" ? nav.juz : scheme === "hizb" ? nav.hizb : nav.rub;
		const p = num ? point(arr, num) : undefined;
		if (p) return [{ surah: p.surah, ayah: p.ayah, kind: scheme as NavCandidate["kind"], label: `${scheme[0].toUpperCase()}${scheme.slice(1)} ${p.n}`, sublabel: `${surahLabel(p.surah)} ${p.surah}:${p.ayah}` }];
		if (num !== undefined) return [];
	}

	// sajda → list the sajdah verses
	if (/^saj?da[h]?$/i.test(q)) {
		return nav.sajdahs.map((s) => ({ surah: s.surah, ayah: s.ayah, kind: "sajdah", label: `Sajdah — ${surahLabel(s.surah)} ${s.surah}:${s.ayah}`, sublabel: s.type }));
	}

	// surah name (+ optional ayah): "baqara", "al-baqarah 255", "البقرة"
	const nameAyah = /^(.*?)(?:\s+(\d{1,3}))?$/.exec(q);
	const namePart = nameAyah?.[1] ?? q;
	const ayahPart = nameAyah?.[2] ? +nameAyah[2] : undefined;
	const nq = normalizeName(namePart);
	if (nq) {
		for (const s of surahs) {
			const hit = [s.nameTransliterated, s.nameEnglish, s.nameArabic].some((nm) => {
				const nn = normalizeName(nm);
				return nn === nq || nn.includes(nq) || nq.includes(nn);
			});
			if (hit) {
				const ayah = ayahPart ?? 1;
				out.push({ surah: s.number, ayah, kind: ayahPart ? "ayah" : "surah", label: `${s.nameTransliterated} ${s.number}${ayahPart ? `:${ayah}` : ""}`, sublabel: s.nameArabic });
			}
		}
	}

	// bare N → surah (primary) + page (secondary)
	if (/^\d{1,3}$/.test(q)) {
		const n = +q;
		if (n >= 1 && n <= 114 && !out.some((c) => c.surah === n && c.kind === "surah")) {
			out.unshift({ surah: n, ayah: 1, kind: "surah", label: `${surahLabel(n)} ${n}`, sublabel: surahs.find((s) => s.number === n)?.nameArabic });
		}
		const pg = point(nav.pages, n);
		if (pg) out.push({ surah: pg.surah, ayah: pg.ayah, kind: "page", label: `Page ${n}`, sublabel: `${surahLabel(pg.surah)} ${pg.surah}:${pg.ayah}` });
	}

	return out;
}

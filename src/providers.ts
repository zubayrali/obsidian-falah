// Provider interfaces plus the first two adapters: AlQuran.cloud for Quran and
// the fawazahmed0 hadith CDN for Hadith. Everything upstream-specific stays here
// so providers can be swapped without touching editor/formatter/renderer code.

import { requestUrl } from "obsidian";
import {
	HADITH_COLLECTION_NAMES,
	HadithRef,
	QuranRef,
	parseShorthand,
	toLabel,
} from "./ref";
import type { HadithContent, VerseContent } from "./data/schema";

export interface QuranSearchResult {
	ref: QuranRef;
	snippet: string;
	surahName?: string;
}

export interface HadithSearchResult {
	ref: HadithRef;
	snippet: string;
}

export interface QuranProvider {
	search(query: string): Promise<QuranSearchResult[]>;
	getVerse(ref: QuranRef): Promise<VerseContent>;
}

export interface HadithProvider {
	search(query: string): Promise<HadithSearchResult[]>;
	getHadith(ref: HadithRef): Promise<HadithContent>;
}

export function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export function quranExternalUrl(ref: QuranRef): string {
	return `https://quran.com/${ref.surah}/${ref.ayah}`;
}

const SUNNAH_SLUGS: Record<string, string> = { nawawi: "nawawi40", qudsi: "qudsi40" };

export function hadithExternalUrl(ref: HadithRef): string {
	return `https://sunnah.com/${SUNNAH_SLUGS[ref.collection] ?? ref.collection}:${ref.number}`;
}

const ALQURAN_API = "https://api.alquran.cloud/v1";

interface AlQuranEditionAyah {
	text: string;
	numberInSurah: number;
	edition: { identifier: string };
	surah: { number: number; name: string; englishName: string; numberOfAyahs: number };
}

export class AlQuranCloudProvider implements QuranProvider {
	constructor(private editions: () => { translation: string; tafsir: string }) {}

	async getVerse(ref: QuranRef): Promise<VerseContent> {
		const { translation, tafsir } = this.editions();
		const ids = ["quran-uthmani", translation, tafsir].filter(Boolean).join(",");
		const last = ref.toAyah ?? ref.ayah;
		if (last - ref.ayah > 29) throw new Error("Range too large (max 30 ayahs)");
		const ayahs: number[] = [];
		for (let a = ref.ayah; a <= last; a++) ayahs.push(a);

		const responses = await Promise.all(
			ayahs.map(async (a) => {
				const res = await requestUrl({
					url: `${ALQURAN_API}/ayah/${ref.surah}:${a}/editions/${ids}`,
					throw: false,
				});
				if (res.status !== 200) throw new Error(`Quran ${ref.surah}:${a} not found`);
				return res.json.data as AlQuranEditionAyah[];
			})
		);

		const byId = (data: AlQuranEditionAyah[], id: string) =>
			data.find((d) => d.edition.identifier === id);

		let arabic = responses.map((d) => byId(d, "quran-uthmani")?.text ?? "").join(" ").trim();
		if (ayahs.length === 1 && (ref.fromWord !== undefined || ref.toWord !== undefined)) {
			// ponytail: whitespace split approximates mushaf word segmentation; swap in a
			// word-index dataset if word-level precision ever matters
			const words = arabic.split(/\s+/);
			const from = (ref.fromWord ?? 1) - 1;
			const to = ref.toWord ?? words.length;
			arabic = words.slice(from, to).join(" ");
			if (from > 0 || to < words.length) arabic = `… ${arabic} …`;
		}

		const numbered = ayahs.length > 1;
		const translationText = translation
			? responses
					.map((d, i) => (numbered ? `(${ayahs[i]}) ` : "") + (byId(d, translation)?.text ?? ""))
					.join(" ")
					.trim() || undefined
			: undefined;
		const tafsirText = tafsir
			? responses.map((d) => byId(d, tafsir)?.text ?? "").join("\n\n").trim() || undefined
			: undefined;

		const meta = responses[0]?.[0]?.surah;
		return {
			ref,
			arabic,
			translation: translationText,
			tafsir: tafsirText,
			surahNameArabic: meta?.name,
			surahNameEnglish: meta?.englishName,
			ayahCount: meta?.numberOfAyahs,
			externalUrl: quranExternalUrl(ref),
		};
	}

	async search(query: string): Promise<QuranSearchResult[]> {
		const edition = /[؀-ۿ]/.test(query) ? "quran-simple" : "en";
		const res = await requestUrl({
			url: `${ALQURAN_API}/search/${encodeURIComponent(query)}/all/${edition}`,
			throw: false,
		});
		if (res.status !== 200) return [];
		const matches = (res.json?.data?.matches ?? []) as Array<{
			text?: string;
			numberInSurah: number;
			surah: { number: number; englishName: string };
		}>;
		return matches.slice(0, 20).map((m) => ({
			ref: { kind: "quran" as const, surah: m.surah.number, ayah: m.numberInSurah },
			snippet: String(m.text ?? "").replace(/<[^>]*>/g, ""),
			surahName: m.surah.englishName,
		}));
	}
}

const HADITH_CDN = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions";

export class HadithCdnProvider implements HadithProvider {
	async getHadith(ref: HadithRef): Promise<HadithContent> {
		if (!(ref.collection in HADITH_COLLECTION_NAMES)) {
			throw new Error(
				`Unknown collection "${ref.collection}". Supported: ${Object.keys(HADITH_COLLECTION_NAMES).join(", ")}`
			);
		}
		// ponytail: the CDN indexes plain numbers; letter-suffixed refs (muslim:8a) fall back to the numeric part
		const num = ref.number.replace(/[a-z]$/, "");
		const [eng, ara] = await Promise.all([
			this.fetchOne(`eng-${ref.collection}`, num),
			this.fetchOne(`ara-${ref.collection}`, num),
		]);
		if (!eng && !ara) throw new Error(`${toLabel(ref)} not found`);
		const grades = (eng?.hadith?.grades ?? [])
			.map((g) => [g.name, g.grade].filter(Boolean).join(": "))
			.filter(Boolean)
			.join(" · ");
		return {
			ref,
			arabic: ara?.hadith?.text,
			translation: eng?.hadith?.text,
			grades: grades || undefined,
			bookName: eng?.name ?? ara?.name,
			externalUrl: hadithExternalUrl(ref),
		};
	}

	private async fetchOne(edition: string, num: string) {
		const res = await requestUrl({ url: `${HADITH_CDN}/${edition}/${num}.json`, throw: false });
		if (res.status !== 200) return null;
		const json = res.json as {
			metadata?: { name?: string };
			hadiths?: Array<{ text?: string; grades?: Array<{ name?: string; grade?: string }> }>;
		};
		const hadith = json?.hadiths?.[0];
		if (!hadith) return null;
		return { hadith, name: json?.metadata?.name };
	}

	async search(query: string): Promise<HadithSearchResult[]> {
		// ponytail: the CDN has no full-text search; reference lookup only. Swap in a
		// searchable provider (e.g. Hadith Unlocked) behind this same interface for text search.
		const ref = parseShorthand(query);
		if (ref?.kind === "hadith") return [{ ref, snippet: "Insert this reference" }];
		return [];
	}
}


import type { FetchJson, DownloadProgress } from "../data/download";
import type {
	MorphologySegment,
	MorphologySegmentType,
	ResourceDescriptor,
	WordMorphology,
	WordSegment,
} from "../data/schema";
import { NetworkError, SchemaError } from "../data/schema";
import type { DataStore } from "../data/store";
import type { Registry } from "../data/registry";
import type { WordByWordVerse } from "./model";

export const WORD_ANALYSIS_RESOURCE_ID = "quran-com-qac-word-analysis";
export const WORD_ANALYSIS_DESCRIPTOR: ResourceDescriptor = {
	id: WORD_ANALYSIS_RESOURCE_ID,
	type: "translation",
	name: "Quran word meanings and grammar",
	language: "en",
	tier: "downloaded",
	version: "qac-0.4",
	cardinality: "per-word",
	license: "Quranic Arabic Corpus GPL; Quran.com word data",
	provenance: {
		author: "Quranic Arabic Corpus and Quran.com",
		provenance: "corpus.quran.com · quran.com",
	},
	meta: {
		morphologySource: "Quranic Arabic Corpus 0.4",
		morphologyUrl: "https://corpus.quran.com",
		wordSource: "Quran.com API",
	},
};

const MORPHOLOGY_URL = "https://raw.githubusercontent.com/cltk/arabic_morphology_quranic-corpus/master/quranic-corpus-morphology-0.4.txt";
const WORDS_URL = (surah: number) =>
	`https://api.quran.com/api/v4/verses/by_chapter/${surah}?language=en&words=true&word_fields=text_uthmani,transliteration,translation&per_page=300&page=1`;

export type FetchText = (url: string) => Promise<string>;

interface CorpusPart {
	location: string;
	wordLocation: string;
	index: number;
	form: string;
	tag: string;
	features: string[];
}

const POS_NAMES: Record<string, string> = {
	N: "Noun", PN: "Proper noun", ADJ: "Adjective", V: "Verb", P: "Preposition",
	PRON: "Pronoun", DET: "Determiner", CONJ: "Conjunction", REL: "Relative pronoun",
	DEM: "Demonstrative", ADV: "Adverb", NEG: "Negative particle", EMPH: "Emphatic particle",
	INTG: "Interrogative", VOC: "Vocative particle", ACC: "Accusative particle",
	SUB: "Subordinating conjunction", T: "Time adverb", LOC: "Location adverb",
};

const FEATURE_NAMES: Record<string, string> = {
	NOM: "Nominative", ACC: "Accusative", GEN: "Genitive",
	M: "Masculine", F: "Feminine", S: "Singular", D: "Dual", P: "Plural",
	ACT: "Active", PASS: "Passive", IND: "Indicative", SUBJ: "Subjunctive", JUS: "Jussive",
	PERF: "Perfect", IMPF: "Imperfect", IMPV: "Imperative",
};

const BUCKWALTER: Record<string, string> = {
	"'": "ء", "|": "آ", ">": "أ", "&": "ؤ", "<": "إ", "}": "ئ", A: "ا", b: "ب", p: "ة",
	t: "ت", v: "ث", j: "ج", H: "ح", x: "خ", d: "د", "*": "ذ", r: "ر", z: "ز", s: "س",
	$: "ش", S: "ص", D: "ض", T: "ط", Z: "ظ", E: "ع", g: "غ", _: "ـ", f: "ف", q: "ق",
	k: "ك", l: "ل", m: "م", n: "ن", h: "ه", w: "و", Y: "ى", y: "ي", F: "ً", N: "ٌ",
	K: "ٍ", a: "َ", u: "ُ", i: "ِ", "~": "ّ", o: "ْ", "`": "ٰ", "{": "ٱ", "@": "۟",
};

export function buckwalterToArabic(value: string): string {
	return [...value].map((character) => BUCKWALTER[character] ?? character).join("");
}

const BUCKWALTER_LATIN: Record<string, string> = {
	"'": "ʾ", ">": "ʾ", "<": "ʾ", "&": "ʾ", "}": "ʾ", "|": "ʾā", "{": "",
	A: "ā", Y: "ā", "`": "ā", v: "th", H: "ḥ", x: "kh", "*": "dh", $: "sh",
	S: "ṣ", D: "ḍ", T: "ṭ", Z: "ẓ", E: "ʿ", g: "gh", p: "h", F: "an", N: "un",
	K: "in", "~": "", o: "", _: "", "@": "",
};

export function buckwalterToTransliteration(value: string): string {
	return [...value].map((character) => BUCKWALTER_LATIN[character] ?? character).join("");
}

export function parseCorpusMorphology(input: string): Map<string, WordMorphology> {
	const grouped = new Map<string, CorpusPart[]>();
	for (const line of input.split(/\r?\n/)) {
		if (!line.startsWith("(")) continue;
		const columns = line.split("\t");
		const match = /^\((\d+):(\d+):(\d+):(\d+)\)$/.exec(columns[0] ?? "");
		if (!match || columns.length < 4) continue;
		const wordLocation = `${match[1]}:${match[2]}:${match[3]}`;
		const part: CorpusPart = {
			location: `${wordLocation}:${match[4]}`,
			wordLocation,
			index: Number(match[4]),
			form: columns[1],
			tag: columns[2],
			features: columns[3].split("|").filter(Boolean),
		};
		const parts = grouped.get(wordLocation) ?? [];
		parts.push(part);
		grouped.set(wordLocation, parts);
	}

	const result = new Map<string, WordMorphology>();
	for (const [location, parts] of grouped) {
		parts.sort((left, right) => left.index - right.index);
		const segments = parts.map(toSegment);
		const tokens = parts.flatMap((part) => part.features);
		const rootBuckwalter = featureValue(tokens, "ROOT:");
		const lemmaBuckwalter = featureValue(tokens, "LEM:");
		const primary = segments.find((segment) => segment.type === "stem") ?? segments[0];
		result.set(location, {
			location,
			root: rootBuckwalter ? buckwalterToArabic(rootBuckwalter) : undefined,
			lemma: lemmaBuckwalter ? buckwalterToArabic(lemmaBuckwalter) : undefined,
			partOfSpeech: primary?.partOfSpeech,
			case: firstNamed(tokens, ["NOM", "ACC", "GEN"]),
			gender: genderFromTokens(tokens),
			number: numberFromTokens(tokens),
			person: personName(tokens),
			voice: firstNamed(tokens, ["ACT", "PASS"]),
			mood: firstNamed(tokens, ["IND", "SUBJ", "JUS"]),
			aspect: firstNamed(tokens, ["PERF", "IMPF", "IMPV"]),
			segments,
		});
	}
	return result;
}

function toSegment(part: CorpusPart): MorphologySegment {
	const type: MorphologySegmentType = part.features.includes("PREFIX") ? "prefix"
		: part.features.includes("STEM") ? "stem"
			: part.features.includes("SUFFIX") ? "suffix" : "unknown";
	const root = featureValue(part.features, "ROOT:");
	const lemma = featureValue(part.features, "LEM:");
	return {
		index: part.index,
		type,
		form: buckwalterToArabic(part.form),
		transliteration: buckwalterToTransliteration(part.form),
		partOfSpeech: POS_NAMES[part.tag] ?? part.tag,
		partOfSpeechCode: part.tag,
		features: part.features,
		root: root ? buckwalterToArabic(root) : undefined,
		lemma: lemma ? buckwalterToArabic(lemma) : undefined,
	};
}

function featureValue(features: string[], prefix: string): string | undefined {
	return features.find((feature) => feature.startsWith(prefix))?.slice(prefix.length);
}

function firstNamed(
	features: string[],
	candidates: string[],
	name: (value: string) => string = (value) => FEATURE_NAMES[value] ?? value,
): string | undefined {
	const value = candidates.find((candidate) => features.includes(candidate));
	return value ? name(value) : undefined;
}

function genderName(value: string): string {
	return value.startsWith("M") ? "Masculine" : value.startsWith("F") ? "Feminine" : value;
}

function numberName(value: string): string {
	const code = value.at(-1) ?? value;
	return FEATURE_NAMES[code] ?? code;
}

function genderFromTokens(features: string[]): string | undefined {
	const value = features.find((feature) => /^[MF]$/.test(feature))
		?? features.find((feature) => /^(?:[123])?[MF][SDP]$/.test(feature));
	const gender = value?.match(/[MF]/)?.[0];
	return gender ? genderName(gender) : undefined;
}

function numberFromTokens(features: string[]): string | undefined {
	const value = features.find((feature) => /^[SDP]$/.test(feature))
		?? features.find((feature) => /^(?:[123])?[MF]?[SDP]$/.test(feature));
	return value ? numberName(value) : undefined;
}

function personName(features: string[]): string | undefined {
	const value = features.find((feature) => /^[123](?:M|F)?(?:S|D|P)$/.test(feature));
	if (!value) return undefined;
	const ordinal = value[0] === "1" ? "First" : value[0] === "2" ? "Second" : "Third";
	return `${ordinal} person`;
}

interface QuranComWord {
	position?: unknown;
	char_type_name?: unknown;
	text_uthmani?: unknown;
	text?: unknown;
	translation?: { text?: unknown };
	transliteration?: { text?: unknown };
}

interface QuranComVerse {
	verse_key?: unknown;
	words?: unknown;
}

export function normalizeQuranComWords(
	input: unknown,
	morphology: Map<string, WordMorphology>,
): WordByWordVerse[] {
	if (!input || typeof input !== "object") throw new SchemaError("Quran.com word response is not an object");
	const verses = (input as { verses?: unknown }).verses;
	if (!Array.isArray(verses)) throw new SchemaError("Quran.com word response has no verses");
	return verses.flatMap((value): WordByWordVerse[] => {
		const verse = value as QuranComVerse;
		if (typeof verse.verse_key !== "string" || !Array.isArray(verse.words)) return [];
		const verseKey = verse.verse_key;
		const words = verse.words.flatMap((value): WordSegment[] => {
			const word = value as QuranComWord;
			if (word.char_type_name !== "word" || typeof word.position !== "number") return [];
			const text = typeof word.text_uthmani === "string" ? word.text_uthmani
				: typeof word.text === "string" ? word.text : "";
			if (!text) return [];
			const location = `${verseKey}:${word.position}`;
			const translation = typeof word.translation?.text === "string" ? word.translation.text : undefined;
			const transliteration = typeof word.transliteration?.text === "string" ? word.transliteration.text : undefined;
			const analysis = morphology.get(location);
			return [{
				position: word.position,
				text,
				translation,
				transliteration,
				morphology: analysis,
				dictionary: {
					headword: analysis?.lemma ?? text,
					root: analysis?.root,
					senses: translation ? [translation] : [],
					source: "Quran.com contextual word translation",
				},
			}];
		});
		return words.length ? [{ ayahKey: verseKey, words }] : [];
	});
}

export async function downloadWordAnalysis(
	deps: { fetchText: FetchText; fetchJson: FetchJson; store: DataStore; registry: Registry },
	onProgress?: (progress: DownloadProgress) => void,
	signal?: AbortSignal,
): Promise<void> {
	let corpus: string;
	try {
		corpus = await deps.fetchText(MORPHOLOGY_URL);
	} catch (error) {
		throw new NetworkError(`Could not download Quranic Arabic Corpus: ${error instanceof Error ? error.message : String(error)}`);
	}
	const morphology = parseCorpusMorphology(corpus);
	if (!morphology.size) throw new SchemaError("Quranic Arabic Corpus contained no morphology rows");
	for (let surah = 1; surah <= 114; surah++) {
		if (signal?.aborted) return;
		if (await deps.registry.isSurahInstalled(WORD_ANALYSIS_RESOURCE_ID, surah)) {
			onProgress?.({ surahsDone: surah, surahsTotal: 114 });
			continue;
		}
		const raw = await deps.fetchJson(WORDS_URL(surah));
		const verses = normalizeQuranComWords(raw, morphology);
		await deps.store.writeSurahFile("translations", WORD_ANALYSIS_RESOURCE_ID, surah, verses);
		await deps.registry.recordSurahInstalled(WORD_ANALYSIS_DESCRIPTOR, surah);
		onProgress?.({ surahsDone: surah, surahsTotal: 114 });
	}
}

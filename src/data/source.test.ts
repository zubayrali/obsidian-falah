import { describe, expect, it } from "vitest";
import { DataError, NotFoundError, NotInstalledError, StorageError } from "./schema";
import type { Ayah, Surah, TranslationVerse } from "./schema";
import { DataStore } from "./store";
import { makeFakeIO } from "./testing";
import { Registry } from "./registry";
import { CoreLoader, CORE_CLEARQURAN_ID } from "./core";
import type { CoreImportMap } from "./core";
import { QuranDataSource } from "./source";
import type { IslamicReference } from "../ref";

const FATIHA_UTHMANI = [
	"بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
	"ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ",
	"ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
];

function makeQuranDataSource(ioSeed: Record<string, string> = {}) {
	const io = makeFakeIO(ioSeed);
	const store = new DataStore(io);
	const uthmani: Ayah[] = FATIHA_UTHMANI.map((text, i) => ({
		ayahKey: `1:${i + 1}`,
		surah: 1,
		ayah: i + 1,
		text,
	}));
	const clearQuran: TranslationVerse[] = FATIHA_UTHMANI.map((_, i) => ({
		ayahKey: `1:${i + 1}`,
		text: `Clear Quran 1:${i + 1}`,
	}));
	const surahs: Surah[] = [
		{ number: 1, nameArabic: "الفاتحة", nameEnglish: "The Opening", nameTransliterated: "Al-Fatihah", ayahCount: 7, revelationPlace: "makkah" },
		{ number: 2, nameArabic: "البقرة", nameEnglish: "The Cow", nameTransliterated: "Al-Baqarah", ayahCount: 3, revelationPlace: "madinah" },
	];
	const imports: CoreImportMap = {
		uthmani: () => Promise.resolve({ default: uthmani }),
		indopak: () => Promise.resolve({ default: [] as Ayah[] }),
		clearquran: () => Promise.resolve({ default: clearQuran }),
		surahs: () => Promise.resolve({ default: surahs }),
	};
	const registry = new Registry(io, store, new CoreLoader(imports));
	return { source: new QuranDataSource(store, registry), io, registry };
}

describe("QuranDataSource.getSurah", () => {
	it("returns bundled surah metadata", async () => {
		const { source } = makeQuranDataSource();
		expect((await source.getSurah(1)).nameEnglish).toBe("The Opening");
	});

	it("throws NotFoundError for an unknown surah number", async () => {
		const { source } = makeQuranDataSource();
		await expect(source.getSurah(99)).rejects.toThrow(NotFoundError);
	});
});

describe("QuranDataSource.getVerse", () => {
	it("reads a bundled-script ayah from core", async () => {
		const { source } = makeQuranDataSource();
		expect(await source.getVerse("1:1", "uthmani")).toEqual({
			ayahKey: "1:1",
			surah: 1,
			ayah: 1,
			text: FATIHA_UTHMANI[0],
		});
	});

	it("reads a downloaded-script ayah from the store, keyed by resource id", async () => {
		const { source } = makeQuranDataSource({
			"qdata/quran/some-downloaded-script/001.json": JSON.stringify([
				{ ayahKey: "1:1", surah: 1, ayah: 1, text: "downloaded text" },
			]),
		});
		expect(await source.getVerse("1:1", "some-downloaded-script")).toEqual({
			ayahKey: "1:1",
			surah: 1,
			ayah: 1,
			text: "downloaded text",
		});
	});

	it("throws NotInstalledError for a missing non-bundled script", async () => {
		const { source } = makeQuranDataSource();
		await expect(source.getVerse("1:1", "never-downloaded")).rejects.toThrow(NotInstalledError);
	});

	it("throws NotFoundError for a malformed key", async () => {
		const { source } = makeQuranDataSource();
		await expect(source.getVerse("nope", "uthmani")).rejects.toThrow(NotFoundError);
	});
});

describe("QuranDataSource.getRange", () => {
	it("joins a range of bundled ayahs in order", async () => {
		const { source } = makeQuranDataSource();
		const ayahs = await source.getRange("1:1", "1:3", "uthmani");
		expect(ayahs.map((a) => a.ayahKey)).toEqual(["1:1", "1:2", "1:3"]);
	});

	it("rejects a cross-surah range with NotFoundError", async () => {
		const { source } = makeQuranDataSource();
		await expect(source.getRange("1:1", "2:1", "uthmani")).rejects.toThrow(NotFoundError);
	});

	it("rejects a range past the surah's true ayah count with NotFoundError", async () => {
		const { source } = makeQuranDataSource();
		// surah 2's bundled metadata says ayahCount 3 in this fixture
		await expect(source.getRange("2:1", "2:5", "uthmani")).rejects.toThrow(NotFoundError);
	});
});

describe("QuranDataSource.getTranslation", () => {
	it("reads the bundled Clear Quran translation", async () => {
		const { source } = makeQuranDataSource();
		expect(await source.getTranslation(CORE_CLEARQURAN_ID, "1:1", "1:2")).toEqual([
			{ ayahKey: "1:1", text: "Clear Quran 1:1" },
			{ ayahKey: "1:2", text: "Clear Quran 1:2" },
		]);
	});

	it("reads a downloaded translation from the store", async () => {
		const { source } = makeQuranDataSource({
			"qdata/translations/fawazahmed0-eng-ahmedali/001.json": JSON.stringify([
				{ ayahKey: "1:1", text: "downloaded translation" },
			]),
		});
		expect(await source.getTranslation("fawazahmed0-eng-ahmedali", "1:1", "1:1")).toEqual([
			{ ayahKey: "1:1", text: "downloaded translation" },
		]);
	});

	it("throws NotInstalledError for a translation never downloaded", async () => {
		const { source } = makeQuranDataSource();
		await expect(source.getTranslation("fawazahmed0-never-downloaded", "1:1", "1:1")).rejects.toThrow(
			NotInstalledError
		);
	});
});

describe("QuranDataSource.getContent", () => {
	it("assembles a single ayah with translation and tafsir", async () => {
		const { source, io } = makeQuranDataSource({
			"qdata/tafsirs/alquran-cloud-ar.muyassar/001.json": JSON.stringify([
				{ ayahKey: "1:1", text: "Tafsir of 1:1" },
			]),
		});
		void io;
		const content = await source.getContent(
			{ kind: "quran", surah: 1, ayah: 1 },
			{ script: "uthmani", translationId: CORE_CLEARQURAN_ID, tafsirId: "alquran-cloud-ar.muyassar" }
		);
		expect(content).toEqual({
			ref: { kind: "quran", surah: 1, ayah: 1 },
			arabic: FATIHA_UTHMANI[0],
			translation: "Clear Quran 1:1",
			translationName: "The Clear Quran (Dr. Mustafa Khattab)",
			tafsir: "Tafsir of 1:1",
			surahNameArabic: "الفاتحة",
			surahNameEnglish: "The Opening",
			ayahCount: 7,
			externalUrl: "https://quran.com/1/1",
		});
	});

	it("numbers translations for a multi-ayah range", async () => {
		const { source } = makeQuranDataSource();
		const content = await source.getContent(
			{ kind: "quran", surah: 1, ayah: 1, toAyah: 2 },
			{ script: "uthmani", translationId: CORE_CLEARQURAN_ID }
		);
		expect(content.translation).toBe("(1) Clear Quran 1:1 (2) Clear Quran 1:2");
	});

	it("numbers present verses by their own ayah key when an interior ayah is missing (Fix D)", async () => {
		// Installed translation has 1:1 and 1:3 but not 1:2. Numbering must follow
		// each verse's true ayah number, not its position in the filtered list.
		const { source } = makeQuranDataSource({
			"qdata/translations/partial-trans/001.json": JSON.stringify([
				{ ayahKey: "1:1", text: "T1" },
				{ ayahKey: "1:3", text: "T3" },
			]),
		});
		const content = await source.getContent(
			{ kind: "quran", surah: 1, ayah: 1, toAyah: 3 },
			{ script: "uthmani", translationId: "partial-trans" }
		);
		expect(content.translation).toBe("(1) T1 (3) T3");
	});

	it("degrades gracefully when the selected translation isn't installed", async () => {
		const { source } = makeQuranDataSource();
		const content = await source.getContent(
			{ kind: "quran", surah: 1, ayah: 1 },
			{ script: "uthmani", translationId: "fawazahmed0-never-downloaded" }
		);
		expect(content.arabic).toBe(FATIHA_UTHMANI[0]);
		expect(content.translation).toBeUndefined();
	});

	it("degrades gracefully when an installed translation file is corrupt (Fix C, spec §11)", async () => {
		// The translation surah file is present but has invalid JSON, so
		// store.loadSurahFile throws SchemaError. The optional-content failure
		// must not abort the verse: Arabic still renders, translation undefined.
		const { source } = makeQuranDataSource({
			"qdata/translations/fawazahmed0-corrupt/001.json": "{not json",
		});
		const content = await source.getContent(
			{ kind: "quran", surah: 1, ayah: 1 },
			{ script: "uthmani", translationId: "fawazahmed0-corrupt" }
		);
		expect(content.arabic).toBe(FATIHA_UTHMANI[0]);
		expect(content.translation).toBeUndefined();
	});

	it("throws NotInstalledError when the script itself is missing", async () => {
		const { source } = makeQuranDataSource();
		await expect(
			source.getContent({ kind: "quran", surah: 1, ayah: 1 }, { script: "never-downloaded" })
		).rejects.toThrow(NotInstalledError);
	});

	it("slices a single ayah by word bounds", async () => {
		const { source } = makeQuranDataSource();
		const content = await source.getContent(
			{ kind: "quran", surah: 1, ayah: 1, fromWord: 1, toWord: 2 },
			{ script: "uthmani" }
		);
		expect(content.arabic).toBe("بِسْمِ ٱللَّهِ …");
	});
});

describe("QuranDataSource.listResources", () => {
	it("delegates to the registry", async () => {
		const { source } = makeQuranDataSource();
		const ids = (await source.listResources()).map((r) => r.id);
		expect(ids).toEqual(["core-uthmani", "core-indopak", "core-en-clearquran"]);
	});
});

import { SourceChain } from "./source";
import type { ContentSource } from "./source";

function fakeSource(id: string, opts: Partial<ContentSource> & { supports?: (ref: IslamicReference) => boolean }): ContentSource {
	return {
		id,
		supports: opts.supports ?? (() => true),
		getContent: opts.getContent ?? (async () => {
			throw new Error("not implemented");
		}),
	};
}

describe("SourceChain", () => {
	it("routes to the first source that supports the ref", async () => {
		const quranOnly = fakeSource("local", {
			supports: (r) => r.kind === "quran",
			getContent: async () => ({ ref: { kind: "quran", surah: 1, ayah: 1 }, arabic: "x", externalUrl: "u" }),
		});
		const liveApi = fakeSource("live-api", {
			getContent: async () => {
				throw new Error("should not be called");
			},
		});
		const chain = new SourceChain([quranOnly, liveApi]);
		const content = await chain.getContent({ kind: "quran", surah: 1, ayah: 1 }, { script: "uthmani" });
		expect(content.arabic).toBe("x");
	});

	it("falls through to the next source on NotInstalledError/NetworkError/NotFoundError", async () => {
		const local = fakeSource("local", {
			getContent: async () => {
				throw new NotInstalledError("core-uthmani");
			},
		});
		const liveApi = fakeSource("live-api", {
			getContent: async () => ({ ref: { kind: "hadith", collection: "bukhari", number: "1" }, externalUrl: "u" }),
		});
		const chain = new SourceChain([local, liveApi]);
		const content = await chain.getContent(
			{ kind: "hadith", collection: "bukhari", number: "1" },
			{ script: "uthmani" }
		);
		expect(content.externalUrl).toBe("u");
	});

	it("rethrows the first source's error when every source fails", async () => {
		const first = new NotInstalledError("core-uthmani", "first error");
		const local = fakeSource("local", {
			getContent: async () => {
				throw first;
			},
		});
		const liveApi = fakeSource("live-api", {
			getContent: async () => {
				throw new Error("second error");
			},
		});
		const chain = new SourceChain([local, liveApi]);
		await expect(chain.getContent({ kind: "quran", surah: 1, ayah: 1 }, { script: "uthmani" })).rejects.toBe(
			first
		);
	});

	it("supports() routes hadith to live-only when QuranDataSource never supports it", async () => {
		const { source: quranDataSource } = makeQuranDataSource();
		const liveApi = fakeSource("live-api", {});
		const chain = new SourceChain([quranDataSource, liveApi]);
		expect(chain.supports({ kind: "hadith", collection: "bukhari", number: "1" })).toBe(true);
		expect(quranDataSource.supports({ kind: "hadith", collection: "bukhari", number: "1" })).toBe(false);
	});

	it("propagates an unrecognized error immediately, without trying later sources", async () => {
		const boom = new Error("unexpected");
		const local = fakeSource("local", {
			getContent: async () => {
				throw boom;
			},
		});
		const liveApi = fakeSource("live-api", { getContent: async () => ({ ref: { kind: "hadith", collection: "bukhari", number: "1" }, externalUrl: "u" }) });
		const chain = new SourceChain([local, liveApi]);
		await expect(chain.getContent({ kind: "quran", surah: 1, ayah: 1 }, { script: "uthmani" })).rejects.toBe(
			boom
		);
	});
});

import { LiveApiSource, RefCache } from "./source";
import { NetworkError } from "./schema";
import type { HadithProvider, HadithSearchResult, QuranProvider, QuranSearchResult } from "../providers";

describe("LiveApiSource", () => {
	function makeLiveApiSource() {
		const cache = new RefCache({}, () => undefined);
		const quran: QuranProvider = {
			search: async () => [{ ref: { kind: "quran", surah: 1, ayah: 1 }, snippet: "s" }],
			getVerse: async (ref) => ({ ref, arabic: "a", externalUrl: "u" }),
		};
		const hadith: HadithProvider = {
			search: async () => [{ ref: { kind: "hadith", collection: "bukhari", number: "1" }, snippet: "s" }],
			getHadith: async (ref) => ({ ref, arabic: "a", externalUrl: "u" }),
		};
		const source = new LiveApiSource(quran, hadith, cache, () => ({ translation: "en.sahih", tafsir: "" }));
		return { source, cache, quran, hadith };
	}

	it("supports both quran and hadith refs", () => {
		const { source } = makeLiveApiSource();
		expect(source.supports({ kind: "quran", surah: 1, ayah: 1 })).toBe(true);
		expect(source.supports({ kind: "hadith", collection: "bukhari", number: "1" })).toBe(true);
	});

	it("fetches then caches content under a translation/tafsir-scoped key", async () => {
		const { source, cache } = makeLiveApiSource();
		const ref = { kind: "quran" as const, surah: 1, ayah: 1 };
		await source.getContent(ref, { script: "uthmani" });
		expect(Object.keys(cache.data)).toEqual(["falah://quran/1/1|en.sahih|"]);
	});

	it("wraps a provider failure in NetworkError", async () => {
		const quran: QuranProvider = {
			search: async () => [],
			getVerse: async () => {
				throw new Error("down");
			},
		};
		const hadith: HadithProvider = {
			search: async () => [],
			getHadith: async (ref) => ({ ref, arabic: "a", externalUrl: "u" }),
		};
		const failing = new LiveApiSource(quran, hadith, new RefCache({}, () => undefined), () => ({
			translation: "en.sahih",
			tafsir: "",
		}));
		await expect(
			failing.getContent({ kind: "quran", surah: 1, ayah: 1 }, { script: "uthmani" })
		).rejects.toThrow(NetworkError);
	});

	it("proxies search to the wrapped providers", async () => {
		const { source } = makeLiveApiSource();
		expect(await source.searchQuran("light")).toHaveLength(1);
		expect(await source.searchHadith("bukhari:1")).toHaveLength(1);
	});
});

describe("typed-error boundary (StorageError)", () => {
	it("wraps a raw disk/OS exception escaping the store as StorageError", async () => {
		const { source, io } = makeQuranDataSource({
			"qdata/quran/broken-script/001.json": "[]",
		});
		// Simulate a permission-denied/disk-full failure: the file is present
		// (`exists` says so) but the read itself throws a raw, non-DataError.
		io.read = async () => {
			throw new Error("EACCES: permission denied");
		};
		let caught: unknown;
		try {
			await source.getVerse("1:1", "broken-script");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(StorageError);
		expect(caught).toBeInstanceOf(DataError);
	});

	it("passes an existing typed error (NetworkError) through the boundary unchanged", async () => {
		const quran: QuranProvider = {
			search: async () => [],
			getVerse: async () => {
				throw new Error("down");
			},
		};
		const hadith: HadithProvider = {
			search: async () => [],
			getHadith: async (ref) => ({ ref, arabic: "a", externalUrl: "u" }),
		};
		const source = new LiveApiSource(quran, hadith, new RefCache({}, () => undefined), () => ({
			translation: "en.sahih",
			tafsir: "",
		}));
		let caught: unknown;
		try {
			await source.getContent({ kind: "quran", surah: 1, ayah: 1 }, { script: "uthmani" });
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(NetworkError);
		expect(caught).not.toBeInstanceOf(StorageError);
	});
});

function makeReadingSource(ioSeed: Record<string, string> = {}) {
	const io = makeFakeIO(ioSeed);
	const store = new DataStore(io);
	const mkAyahs = (surah: number, count: number): Ayah[] =>
		Array.from({ length: count }, (_, i) => ({
			ayahKey: `${surah}:${i + 1}`,
			surah,
			ayah: i + 1,
			text: `ar ${surah}:${i + 1}`,
		}));
	const uthmani: Ayah[] = [...mkAyahs(1, 3), ...mkAyahs(2, 2), ...mkAyahs(9, 2)];
	const surahs: Surah[] = [
		{ number: 1, nameArabic: "الفاتحة", nameEnglish: "The Opening", nameTransliterated: "Al-Fatihah", ayahCount: 3, revelationPlace: "makkah" },
		{ number: 2, nameArabic: "البقرة", nameEnglish: "The Cow", nameTransliterated: "Al-Baqarah", ayahCount: 2, revelationPlace: "madinah" },
		{ number: 9, nameArabic: "التوبة", nameEnglish: "The Repentance", nameTransliterated: "At-Tawbah", ayahCount: 2, revelationPlace: "madinah" },
	];
	const imports: CoreImportMap = {
		uthmani: () => Promise.resolve({ default: uthmani }),
		indopak: () => Promise.resolve({ default: [] as Ayah[] }),
		clearquran: () => Promise.resolve({ default: [] as TranslationVerse[] }),
		surahs: () => Promise.resolve({ default: surahs }),
	};
	const registry = new Registry(io, store, new CoreLoader(imports));
	return { source: new QuranDataSource(store, registry) };
}

// index.json + resource files that make "tr" (translation) and "tf" (tafsir)
// installed for surah 2, so listResources() resolves their names.
const READING_SEED: Record<string, string> = {
	"qdata/index.json": JSON.stringify({
		version: 1,
		resources: {
			tr: { type: "translation", name: "My Translation", language: "en", tier: "downloaded", installedAt: 0, surahs: [2] },
			tf: { type: "tafsir", name: "My Tafsir", language: "en", tier: "downloaded", installedAt: 0, surahs: [2] },
		},
	}),
	"qdata/translations/tr/002.json": JSON.stringify([
		{ ayahKey: "2:1", text: "tr 2:1" },
		{ ayahKey: "2:2", text: "tr 2:2" },
	]),
	"qdata/tafsirs/tf/002.json": JSON.stringify([
		{ ayahKey: "2:1", text: "tafsir 2:1" },
		{ ayahKey: "2:2", text: "tafsir 2:2" },
	]),
};

describe("QuranDataSource.getSurahReading", () => {
	it("merges Arabic + translation + tafsir by ayah key", async () => {
		const { source } = makeReadingSource(READING_SEED);
		const reading = await source.getSurahReading(2, { script: "uthmani", translationId: "tr", tafsirId: "tf" });
		expect(reading.surah.nameEnglish).toBe("The Cow");
		expect(reading.showBismillah).toBe(true);
		expect(reading.translationName).toBe("My Translation");
		expect(reading.tafsirName).toBe("My Tafsir");
		expect(reading.ayahs).toEqual([
			{ ayah: 1, ayahKey: "2:1", arabic: "ar 2:1", translation: "tr 2:1", tafsir: "tafsir 2:1" },
			{ ayah: 2, ayahKey: "2:2", arabic: "ar 2:2", translation: "tr 2:2", tafsir: "tafsir 2:2" },
		]);
	});

	it("omits the Bismillah header for surah 1 and surah 9", async () => {
		const { source } = makeReadingSource(READING_SEED);
		expect((await source.getSurahReading(1, { script: "uthmani" })).showBismillah).toBe(false);
		expect((await source.getSurahReading(9, { script: "uthmani" })).showBismillah).toBe(false);
	});

	it("degrades to empty translation/tafsir when the resource is missing (no throw)", async () => {
		const { source } = makeReadingSource();
		const reading = await source.getSurahReading(2, { script: "uthmani", translationId: "nope", tafsirId: "nope" });
		expect(reading.ayahs.map((a) => a.translation)).toEqual([undefined, undefined]);
		expect(reading.ayahs.map((a) => a.tafsir)).toEqual([undefined, undefined]);
	});

	it("applies a group tafsir (ayahKeys) to every covered ayah", async () => {
		const { source } = makeReadingSource({
			"qdata/tafsirs/tfg/002.json": JSON.stringify([
				{ ayahKey: "2:1", ayahKeys: ["2:1", "2:2"], text: "group tafsir" },
			]),
		});
		const reading = await source.getSurahReading(2, { script: "uthmani", tafsirId: "tfg" });
		expect(reading.ayahs.map((a) => a.tafsir)).toEqual(["group tafsir", "group tafsir"]);
	});
});

function makeVerseTafsirSource(ioSeed: Record<string, string> = {}) {
	const io = makeFakeIO(ioSeed);
	const store = new DataStore(io);
	const empty: CoreImportMap = {
		uthmani: () => Promise.resolve({ default: [] as Ayah[] }),
		indopak: () => Promise.resolve({ default: [] as Ayah[] }),
		clearquran: () => Promise.resolve({ default: [] as TranslationVerse[] }),
		surahs: () => Promise.resolve({ default: [] as Surah[] }),
	};
	const registry = new Registry(io, store, new CoreLoader(empty));
	return new QuranDataSource(store, registry);
}

const VERSE_TAFSIR_SEED: Record<string, string> = {
	"qdata/index.json": JSON.stringify({
		version: 1,
		resources: {
			tf: { type: "tafsir", name: "My Tafsir", language: "en", tier: "downloaded", installedAt: 0, surahs: [2] },
		},
	}),
	"qdata/tafsirs/tf/002.json": JSON.stringify([
		{ ayahKey: "2:1", text: "single one" },
		{ ayahKey: "2:2", ayahKeys: ["2:2", "2:3"], text: "grouped two-three" },
	]),
};

describe("QuranDataSource.getVerseTafsir", () => {
	it("returns a single-verse tafsir with its resource name", async () => {
		const source = makeVerseTafsirSource(VERSE_TAFSIR_SEED);
		expect(await source.getVerseTafsir("tf", 2, 1)).toEqual({ name: "My Tafsir", text: "single one" });
	});

	it("resolves a grouped tafsir for a middle-of-group ayah (via ayahKeys)", async () => {
		const source = makeVerseTafsirSource(VERSE_TAFSIR_SEED);
		expect(await source.getVerseTafsir("tf", 2, 3)).toEqual({ name: "My Tafsir", text: "grouped two-three" });
	});

	it("returns undefined for an ayah the tafsir doesn't cover", async () => {
		const source = makeVerseTafsirSource(VERSE_TAFSIR_SEED);
		expect(await source.getVerseTafsir("tf", 2, 7)).toBeUndefined();
	});

	it("returns undefined for a tafsir that isn't installed", async () => {
		const source = makeVerseTafsirSource(VERSE_TAFSIR_SEED);
		expect(await source.getVerseTafsir("missing", 2, 1)).toBeUndefined();
	});
});

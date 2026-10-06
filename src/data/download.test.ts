import { describe, expect, it } from "vitest";
import { NetworkError, NotFoundError, SchemaError } from "./schema";
import { AlQuranCloudSource, Fawazahmed0Source, QulSource, downloadResource } from "./download";
import { DataStore } from "./store";
import { makeFakeIO } from "./testing";
import { Registry } from "./registry";
import { CoreLoader } from "./core";
import type { CoreImportMap } from "./core";
import type { Ayah, Surah, TranslationVerse as _TV } from "./schema";
import type { DownloadSource, DownloadProgress } from "./download";

describe("Fawazahmed0Source", () => {
	it("listCatalog requests editions.json and normalizes translations only", async () => {
		const requested: string[] = [];
		const fetchJson = async (url: string) => {
			requested.push(url);
			return {
				eng_ahmedali: {
					name: "eng-ahmedali",
					author: "Ahmed Ali",
					language: "English",
					link: "x",
					linkmin: "x",
				},
			};
		};
		const source = new Fawazahmed0Source(fetchJson);
		const catalog = await source.listCatalog("translation");
		expect(requested).toEqual(["https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions.json"]);
		expect(catalog).toEqual([
			{
				id: "fawazahmed0-eng-ahmedali",
				type: "translation",
				name: "Ahmed Ali",
				language: "en",
				tier: "downloaded",
				source: "fawazahmed0",
				sourceResourceId: "eng-ahmedali",
				license: "Unlicense (public domain)",
			},
		]);
	});

	it("listCatalog returns nothing for tafsir (fawazahmed0 ships translations only)", async () => {
		const source = new Fawazahmed0Source(async () => ({}));
		expect(await source.listCatalog("tafsir")).toEqual([]);
	});

	it("fetchSurah requests the per-chapter file and normalizes it", async () => {
		const requested: string[] = [];
		const fetchJson = async (url: string) => {
			requested.push(url);
			return { chapter: [{ chapter: 1, verse: 1, text: "In the name of Allah" }] };
		};
		const source = new Fawazahmed0Source(async () => ({}));
		const desc = {
			id: "fawazahmed0-eng-ahmedali",
			type: "translation" as const,
			name: "Ahmed Ali",
			language: "en",
			tier: "downloaded" as const,
			source: "fawazahmed0" as const,
			sourceResourceId: "eng-ahmedali",
		};
		const verses = await source.fetchSurah(desc, 1, 7, fetchJson);
		expect(requested).toEqual([
			"https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/eng-ahmedali/1.json",
		]);
		expect(verses).toEqual([{ ayahKey: "1:1", text: "In the name of Allah" }]);
	});

	it("wraps a thrown/non-OK fetch as a typed NetworkError, not a raw exception", async () => {
		const source = new Fawazahmed0Source(async () => {
			throw new Error("HTTP 500");
		});
		await expect(source.listCatalog("translation")).rejects.toThrow(NetworkError);
	});
});

describe("AlQuranCloudSource", () => {
	it("does not offer audio editions as downloadable text translations", async () => {
		const source = new AlQuranCloudSource(async () => ({ code: 200, data: [
			{ identifier: "ar.minshawi", type: "translation", format: "audio", englishName: "Minshawi" },
			{ identifier: "en.sahih", type: "translation", format: "text", englishName: "Sahih", language: "en" },
		] }));
		expect((await source.listCatalog("translation")).map((d) => d.sourceResourceId)).toEqual(["en.sahih"]);
	});
	it("listCatalog requests /edition and filters by requested type", async () => {
		const requested: string[] = [];
		const fetchJson = async (url: string) => {
			requested.push(url);
			return {
				code: 200,
				status: "OK",
				data: [
					{ identifier: "en.sahih", language: "en", name: "Saheeh International", englishName: "Saheeh International", format: "text", type: "translation", direction: "ltr" },
					{ identifier: "ar.muyassar", language: "ar", name: "تفسير الميسر", englishName: "King Fahad Quran Complex", format: "text", type: "tafsir", direction: "rtl" },
				],
			};
		};
		const source = new AlQuranCloudSource(fetchJson);
		const translations = await source.listCatalog("translation");
		expect(requested).toEqual(["https://api.alquran.cloud/v1/edition"]);
		expect(translations).toEqual([
			{ id: "alquran-cloud-en.sahih", type: "translation", name: "Saheeh International", language: "en", tier: "downloaded", source: "alquran-cloud", sourceResourceId: "en.sahih", license: "AlQuran.cloud open edition" },
		]);
	});

	it("fetchSurah requests /surah/<n>/<edition> and normalizes it", async () => {
		const requested: string[] = [];
		const fetchJson = async (url: string) => {
			requested.push(url);
			return {
				code: 200,
				status: "OK",
				data: { number: 1, ayahs: [{ number: 1, text: "x", numberInSurah: 1 }] },
			};
		};
		const source = new AlQuranCloudSource(async () => ({}));
		const desc = {
			id: "alquran-cloud-en.sahih",
			type: "translation" as const,
			name: "Saheeh International",
			language: "en",
			tier: "downloaded" as const,
			source: "alquran-cloud" as const,
			sourceResourceId: "en.sahih",
		};
		const verses = await source.fetchSurah(desc, 1, 7, fetchJson);
		expect(requested).toEqual(["https://api.alquran.cloud/v1/surah/1/en.sahih"]);
			expect(verses).toEqual([{ ayahKey: "1:1", text: "x" }]);
		});

		it("fetchAllSurahs uses one Quran request to avoid provider rate limits", async () => {
			const requested: string[] = [];
			const source = new AlQuranCloudSource(async () => ({}));
			const desc = {
				id: "alquran-cloud-en.sahih",
				type: "translation" as const,
				name: "Saheeh International",
				language: "en",
				tier: "downloaded" as const,
				source: "alquran-cloud" as const,
				sourceResourceId: "en.sahih",
			};
			const bySurah = await source.fetchAllSurahs(desc, async (url) => {
				requested.push(url);
				return {
					code: 200,
					data: { surahs: [{ number: 1, ayahs: [{ numberInSurah: 1, text: "x" }] }] },
				};
			});
			expect(requested).toEqual(["https://api.alquran.cloud/v1/quran/en.sahih"]);
			expect(bySurah.get(1)).toEqual([{ ayahKey: "1:1", text: "x" }]);
		});

		it("wraps a thrown fetch as a typed NetworkError", async () => {
		const source = new AlQuranCloudSource(async () => {
			throw new Error("timeout");
		});
		await expect(source.listCatalog("translation")).rejects.toThrow(NetworkError);
	});
});

describe("QulSource", () => {
	it("recovers omitted verses from the same resource's grouped passage", async () => {
		const urls: string[] = [];
		const desc = { id: "qul-164", sourceResourceId: "164", type: "tafsir" as const, name: "Tafsir", language: "en", tier: "downloaded" as const };
		const rows = await new QulSource(async () => ({})).fetchSurah(desc, 2, 3, async (url) => {
			urls.push(url);
			return urls.length === 1
				? { tafsirs: [{ verse_key: "2:1", text: "Partial" }] }
				: { tafsir: { resource_id: 164, verses: { "2:1": {}, "2:2": {}, "2:3": {} }, text: "<p>Group</p>" } };
		});
		expect(urls).toHaveLength(2);
		expect(urls[1]).toContain("/164/by_ayah/2:2");
		expect(rows).toEqual([{ ayahKey: "2:1", ayahKeys: ["2:1", "2:2", "2:3"], text: "Group" }]);
	});

	it("retains measured gaps when a targeted passage is unavailable", async () => {
		const desc = { id: "qul-164", sourceResourceId: "164", type: "tafsir" as const, name: "Tafsir", language: "en", tier: "downloaded" as const };
		const rows = await new QulSource(async () => ({})).fetchSurah(desc, 2, 2, async (url) => {
			if (url.includes("by_ayah")) throw new Error("HTTP 404");
			return { tafsirs: [{ verse_key: "2:1", text: "Available" }] };
		});
		expect(rows).toEqual([{ ayahKey: "2:1", text: "Available" }]);
	});
	it("fetches every tafsir page before returning a chapter", async () => {
		const urls: string[] = [];
		const desc = { id: "qul-169", sourceResourceId: "169", type: "tafsir" as const, name: "Ibn Kathir", language: "en", tier: "downloaded" as const };
		const rows = await new QulSource(async () => ({})).fetchSurah(desc, 2, 2, async (url) => {
			urls.push(url);
			const page = urls.length;
			return { tafsirs: [{ verse_key: `2:${page}`, text: `<p>Page ${page}</p>` }], pagination: { next_page: page === 1 ? 2 : null } };
		});
		expect(urls).toEqual(["https://api.quran.com/api/v4/tafsirs/169/by_chapter/2?per_page=300", "https://api.quran.com/api/v4/tafsirs/169/by_chapter/2?per_page=300&page=2"]);
		expect(rows.map((row) => row.ayahKey)).toEqual(["2:1", "2:2"]);
	});

	it("rejects a repeating tafsir page instead of looping forever", async () => {
		const desc = { id: "qul-169", sourceResourceId: "169", type: "tafsir" as const, name: "Ibn Kathir", language: "en", tier: "downloaded" as const };
		await expect(new QulSource(async () => ({})).fetchSurah(desc, 2, 286, async () => ({
			tafsirs: [{ verse_key: "2:1", text: "x" }], pagination: { next_page: 1 },
		}))).rejects.toThrow(SchemaError);
	});

	it("listCatalog requests Quran.com resources/translations for type translation", async () => {
		const requested: string[] = [];
		const fetchJson = async (url: string) => {
			requested.push(url);
			return { translations: [{ id: 149, name: "Bridges", language: "english" }] };
		};
		const source = new QulSource(fetchJson);
		const catalog = await source.listCatalog("translation");
		expect(requested).toEqual(["https://api.quran.com/api/v4/resources/translations"]);
		expect(catalog[0].id).toBe("qul-149");
	});

	it("listCatalog requests /resources/tafsirs for type tafsir", async () => {
		const requested: string[] = [];
		const fetchJson = async (url: string) => {
			requested.push(url);
			return { tafsirs: [] };
		};
		await new QulSource(fetchJson).listCatalog("tafsir");
		expect(requested).toEqual(["https://api.quran.com/api/v4/resources/tafsirs"]);
	});

	it("listCatalog returns nothing for non-downloadable types", async () => {
		expect(await new QulSource(async () => ({})).listCatalog("quran-script")).toEqual([]);
	});

	it("fetchSurah requests the Quran.com chapter with verse keys", async () => {
		const requested: string[] = [];
		const fetchJson = async (url: string) => {
			requested.push(url);
			return { translations: [{ verse_key: "1:1", text: "x" }] };
		};
		const source = new QulSource(async () => ({}));
		const desc = {
			id: "qul-149",
			type: "translation" as const,
			name: "Bridges",
			language: "en",
			tier: "downloaded" as const,
			source: "qul" as const,
			sourceResourceId: "149",
		};
		const verses = await source.fetchSurah(desc, 1, 7, fetchJson);
		expect(requested).toEqual([
			"https://api.quran.com/api/v4/quran/translations/149?chapter_number=1&fields=verse_key",
		]);
		expect(verses).toEqual([{ ayahKey: "1:1", text: "x" }]);
	});

	it("fetchSurah requests and normalizes a Quran.com tafsir chapter", async () => {
		const requested: string[] = [];
		const source = new QulSource(async () => ({}));
		const desc = {
			id: "qul-169",
			type: "tafsir" as const,
			name: "Ibn Kathir (Abridged)",
			language: "en",
			tier: "downloaded" as const,
			source: "qul" as const,
			sourceResourceId: "169",
		};
		const verses = await source.fetchSurah(desc, 1, 1, async (url) => {
			requested.push(url);
			return { tafsirs: [{ verse_key: "1:1", text: "<p>Commentary</p>" }] };
		});
		expect(requested).toEqual(["https://api.quran.com/api/v4/tafsirs/169/by_chapter/1?per_page=300"]);
		expect(verses).toEqual([{ ayahKey: "1:1", text: "Commentary" }]);
	});

	it("wraps a thrown fetch as a typed NetworkError", async () => {
		const source = new QulSource(async () => {
			throw new Error("dns failure");
		});
		await expect(source.listCatalog("translation")).rejects.toThrow(NetworkError);
	});
});

function makeRegistryWithSurahs(surahs: Surah[]): { io: ReturnType<typeof makeFakeIO>; registry: Registry } {
	const io = makeFakeIO();
	const imports: CoreImportMap = {
		uthmani: () => Promise.resolve({ default: [] as Ayah[] }),
		indopak: () => Promise.resolve({ default: [] as Ayah[] }),
		clearquran: () => Promise.resolve({ default: [] as _TV[] }),
		surahs: () => Promise.resolve({ default: surahs }),
		nav: () =>
			Promise.resolve({ default: { juz: [], hizb: [], rub: [], pages: [], sajdahs: [], ruku: [] } }),
	};
	const registry = new Registry(io, new DataStore(io), new CoreLoader(imports));
	return { io, registry };
}

function fakeSource(fetchSurah: DownloadSource["fetchSurah"]): DownloadSource {
	return { id: "fawazahmed0", listCatalog: async () => [], fetchSurah };
}

describe("downloadResource", () => {
	const surahs: Surah[] = [
		{ number: 1, nameArabic: "ا", nameEnglish: "A", nameTransliterated: "A", ayahCount: 7, revelationPlace: "makkah" },
		{ number: 2, nameArabic: "ب", nameEnglish: "B", nameTransliterated: "B", ayahCount: 5, revelationPlace: "madinah" },
	];
	const desc = {
		id: "fawazahmed0-eng-ahmedali",
		type: "translation" as const,
		name: "Ahmed Ali",
		language: "en",
		tier: "downloaded" as const,
		source: "fawazahmed0" as const,
		sourceResourceId: "eng-ahmedali",
	};

	it("writes each surah atomically and records it in the index", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		const source = fakeSource(async (_d, surah) => [{ ayahKey: `${surah}:1`, text: `s${surah}` }]);
		await downloadResource(desc, source, { fetchJson: async () => ({}), store, registry });
		expect(io.calls).toContain("rename:qdata/translations/fawazahmed0-eng-ahmedali/001.json.tmp->qdata/translations/fawazahmed0-eng-ahmedali/001.json");
		expect(await registry.isSurahInstalled(desc.id, 1)).toBe(true);
		expect(await registry.isSurahInstalled(desc.id, 2)).toBe(true);
	});

	it("reports progress after each surah", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		const source = fakeSource(async (_d, surah) => [{ ayahKey: `${surah}:1`, text: "x" }]);
		const progress: DownloadProgress[] = [];
		await downloadResource(desc, source, { fetchJson: async () => ({}), store, registry }, (p) => progress.push(p));
		expect(progress).toEqual([
			{ surahsDone: 1, surahsTotal: 2 },
			{ surahsDone: 2, surahsTotal: 2 },
		]);
	});

	it("resumes a partial install, skipping already-installed surahs", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		await registry.recordSurahInstalled(desc, 1);
		const fetched: number[] = [];
		const source = fakeSource(async (_d, surah) => {
			fetched.push(surah);
			return [{ ayahKey: `${surah}:1`, text: "x" }];
		});
		await downloadResource(desc, source, { fetchJson: async () => ({}), store, registry });
		expect(fetched).toEqual([2]); // surah 1 already installed, skipped
	});

	it("leaves a valid partial install when a surah fetch fails mid-way", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		const source = fakeSource(async (_d, surah) => {
			if (surah === 2) throw new Error("network down");
			return [{ ayahKey: `${surah}:1`, text: "x" }];
		});
		await expect(
			downloadResource(desc, source, { fetchJson: async () => ({}), store, registry })
		).rejects.toThrow("network down");
		expect(await registry.isSurahInstalled(desc.id, 1)).toBe(true);
		expect(await registry.isSurahInstalled(desc.id, 2)).toBe(false);
	});

	it("keeps the previous descriptor current until a replacement fully succeeds", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		const previous = { ...desc, version: "1" };
		await registry.recordResourceInstalled(previous, [1, 2]);
		const replacement = { ...desc, version: "2" };
		const source = fakeSource(async (_d, surah) => {
			if (surah === 2) throw new Error("network down");
			return [{ ayahKey: `${surah}:1`, text: "new" }];
		});

		await expect(downloadResource(
			replacement,
			source,
			{ fetchJson: async () => ({}), store, registry },
			undefined,
			undefined,
			{ replaceExisting: true },
		)).rejects.toThrow("network down");

		const installed = (await registry.listInstalled()).find((resource) => resource.id === desc.id);
		expect(installed?.version).toBe("1");
		expect(installed?.installedSurahs).toEqual([1, 2]);
	});

	it("atomically marks a completed replacement as the new version", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		await registry.recordResourceInstalled({ ...desc, version: "1" }, [1, 2]);
		const fetched: number[] = [];
		const replacement = { ...desc, version: "2" };

		await downloadResource(
			replacement,
			fakeSource(async (_d, surah) => {
				fetched.push(surah);
				return [{ ayahKey: `${surah}:1`, text: "new" }];
			}),
			{ fetchJson: async () => ({}), store, registry },
			undefined,
			undefined,
			{ replaceExisting: true },
		);

		const installed = (await registry.listInstalled()).find((resource) => resource.id === desc.id);
		expect(fetched).toEqual([1, 2]);
		expect(installed?.version).toBe("2");
		expect(installed?.installedSurahs).toEqual([1, 2]);
	});

	it("stops early when the signal is already aborted", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		const fetched: number[] = [];
		const source = fakeSource(async (_d, surah) => {
			fetched.push(surah);
			return [];
		});
		const controller = new AbortController();
		controller.abort();
		await downloadResource(
			desc,
			source,
			{ fetchJson: async () => ({}), store, registry },
			undefined,
			controller.signal
		);
		expect(fetched).toEqual([]);
	});

	it("refuses a non-downloadable resource type (e.g. recitation) with a typed error", async () => {
		const { registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(makeFakeIO());
		const recitationDesc = { ...desc, id: "qul-recitation-1", type: "recitation" as const };
		const source = fakeSource(async () => {
			throw new Error("must not be called");
		});
		await expect(
			downloadResource(recitationDesc, source, { fetchJson: async () => ({}), store, registry })
		).rejects.toThrow(NotFoundError);
	});

	it("propagates a malformed-response SchemaError through the pipeline (not re-wrapped as NetworkError)", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		// A real adapter runs a real normalizer: the fetch succeeds (no network error)
		// but returns a syntactically-fine, wrong-shaped body, so normalizeFawazSurah
		// throws SchemaError. fetchOrThrowNetwork must pass that typed DataError
		// through unwrapped rather than masking it as a NetworkError.
		const source = new Fawazahmed0Source(async () => ({}));
		const malformed = { fetchJson: async () => ({ not: "a chapter array" }), store, registry };
		await expect(downloadResource(desc, source, malformed)).rejects.toThrow(SchemaError);
		expect(await registry.isSurahInstalled(desc.id, 1)).toBe(false);
	});

	it("fetches surahs strictly one at a time (no overlapping in-flight fetches)", async () => {
		const { io, registry } = makeRegistryWithSurahs(surahs);
		const store = new DataStore(io);
		let inFlight = 0;
		let maxInFlight = 0;
		const order: number[] = [];
		const source = fakeSource(async (_d, surah) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			order.push(surah);
			await new Promise((r) => setTimeout(r, 1));
			inFlight--;
			return [{ ayahKey: `${surah}:1`, text: "x" }];
		});
		await downloadResource(desc, source, { fetchJson: async () => ({}), store, registry });
		expect(maxInFlight).toBe(1);
		expect(order).toEqual([1, 2]);
	});
});

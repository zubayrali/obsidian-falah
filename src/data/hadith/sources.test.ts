import { describe, expect, it } from "vitest";
import { NetworkError } from "../schema";
import {
	AHMEDBASET_BOOKS,
	MHASHIM_BOOKS,
	AhmedBasetHadithSource,
	Fawazahmed0HadithSource,
	OpenHadithCsvSource,
	SunnahComHadithSource,
} from "./sources";

describe("hardcoded hadith catalogs", () => {
	it("AhmedBaset lists the nine books plus extras, all AR+EN", () => {
		expect(AHMEDBASET_BOOKS.length).toBeGreaterThanOrEqual(9);
		for (const e of AHMEDBASET_BOOKS) {
			expect(e.source).toBe("ahmedbaset");
			expect(e.languages).toContain("eng");
			expect(e.collection).toMatch(/^[a-z0-9_]+$/);
			expect(e.name.length).toBeGreaterThan(0);
		}
		expect(AHMEDBASET_BOOKS.map((e) => e.collection)).toContain("bukhari");
	});

	it("mhashim6 lists Arabic-only books", () => {
		expect(MHASHIM_BOOKS.length).toBeGreaterThanOrEqual(9);
		for (const e of MHASHIM_BOOKS) {
			expect(e.source).toBe("mhashim6");
			expect(e.languages).toEqual(["ara"]);
		}
	});
});

describe("hadith source adapters", () => {
	it("loads and normalizes the Fawaz catalogue and bilingual collection", async () => {
		const source = new Fawazahmed0HadithSource();
		const catalogUrls: string[] = [];
		const catalog = await source.listCatalog(async (url) => {
			catalogUrls.push(url);
			return { bukhari: { name: "Sahih al-Bukhari", collection: [{ name: "ara-bukhari" }, { name: "eng-bukhari" }] } };
		});
		expect(catalogUrls[0]).toContain("fawazahmed0/hadith-api@1/editions.json");
		expect(catalog[0].languages).toEqual(["ara", "eng"]);

		const urls: string[] = [];
		const collection = await source.fetchCollection("bukhari", "eng", async (url) => {
			urls.push(url);
			return url.includes("ara-bukhari")
				? { metadata: { name: "البخاري" }, hadiths: [{ hadithnumber: 1, text: "عربي" }] }
				: { metadata: { name: "Bukhari" }, hadiths: [{ hadithnumber: 1, text: "English" }] };
		});
		expect(urls).toHaveLength(2);
		expect(collection.hadiths[0]).toMatchObject({ number: 1, arabic: "عربي", translation: "English" });
	});

	it("uses the AhmedBaset book path and normalizes Arabic and English", async () => {
		const urls: string[] = [];
		const collection = await new AhmedBasetHadithSource().fetchCollection("bukhari", "eng", async (url) => {
			urls.push(url);
			return {
				metadata: { english: { title: "Bukhari" }, arabic: { title: "البخاري" } },
				hadiths: [{ idInBook: 1, arabic: "عربي", english: { narrator: "Narrator", text: "English" } }],
			};
		});
		expect(urls).toEqual(["https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book/the_9_books/bukhari.json"]);
		expect(collection.hadiths[0]).toMatchObject({ number: 1, narrator: "Narrator", translation: "English" });
	});

	it("maps AhmedBaset collection slugs whose upstream filenames differ", async () => {
		const urls: string[] = [];
		const fetchJson = async (url: string) => {
			urls.push(url);
			return { hadiths: [] };
		};
		const source = new AhmedBasetHadithSource();
		await source.fetchCollection("nawawi", "eng", fetchJson);
		await source.fetchCollection("adab_almufrad", "eng", fetchJson);
		expect(urls).toEqual([
			"https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book/forties/nawawi40.json",
			"https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book/other_books/aladab_almufrad.json",
		]);
	});

	it("uses the sunnah.com key, catalogue, and paged collection contracts", async () => {
		const requests: { url: string; key: string }[] = [];
		const source = new SunnahComHadithSource(() => "secret", async (url, key) => {
			requests.push({ url, key });
			if (url.endsWith("/collections?limit=50")) {
				return { data: [{ name: "bukhari", collection: [{ lang: "en", title: "Bukhari" }] }] };
			}
			return {
				collection: { name: "Bukhari" },
				data: [{ hadithNumber: "1", hadith: [{ lang: "ar", body: "عربي" }, { lang: "en", body: "English" }] }],
			};
		});
		const genericTransport = async () => { throw new Error("authenticated transport should be used"); };
		const catalog = await source.listCatalog(genericTransport);
		expect(catalog[0].name).toBe("Bukhari");
		const collection = await source.fetchCollection("bukhari", "eng", genericTransport);
		expect(requests).toEqual([
			{ url: "https://api.sunnah.com/v1/collections?limit=50", key: "secret" },
			{ url: "https://api.sunnah.com/v1/collections/bukhari/hadiths?page=1&limit=100", key: "secret" },
		]);
		expect(collection.hadiths[0].translation).toBe("English");
	});

	it("refuses sunnah.com requests without an API key", async () => {
		await expect(new SunnahComHadithSource(() => "").listCatalog(async () => ({}))).rejects.toThrow(NetworkError);
	});

	it("loads Open Hadith CSV through the text transport", async () => {
		const urls: string[] = [];
		const collection = await new OpenHadithCsvSource().fetchCollection("bukhari", "ara", async (url) => {
			urls.push(url);
			return '"1","نص الحديث"';
		});
		expect(urls[0]).toContain("Sahih_Al-Bukhari/sahih_al-bukhari_ahadith_mushakkala_mufassala.utf8.csv");
		expect(collection.hadiths).toEqual([{ number: 1, arabic: "نص الحديث" }]);
	});

	it("wraps provider transport failures as typed network errors", async () => {
		await expect(new AhmedBasetHadithSource().fetchCollection("bukhari", "eng", async () => {
			throw new Error("HTTP 503");
		})).rejects.toThrow(NetworkError);
	});

	it("honours an already-aborted collection download", async () => {
		const controller = new AbortController();
		controller.abort();
		let called = false;
		await expect(new Fawazahmed0HadithSource().fetchCollection("bukhari", "eng", async () => {
			called = true;
			return {};
		}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
		expect(called).toBe(false);
	});
});

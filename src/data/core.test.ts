import { describe, expect, it, vi } from "vitest";
import { CORE_CLEARQURAN_ID, CORE_INDOPAK_ID, CORE_UTHMANI_ID, CoreLoader } from "./core";
import type { CoreImportMap } from "./core";
import type { Ayah, Surah, TranslationVerse } from "./schema";

function makeImports(): CoreImportMap {
	const uthmaniAyahs: Ayah[] = [{ ayahKey: "1:1", surah: 1, ayah: 1, text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ" }];
	const clearQuran: TranslationVerse[] = [
		{ ayahKey: "1:1", text: "In the Name of Allah—the Most Compassionate, Most Merciful." },
	];
	const surahs: Surah[] = [
		{
			number: 1,
			nameArabic: "الفاتحة",
			nameEnglish: "The Opening",
			nameTransliterated: "Al-Fatihah",
			ayahCount: 7,
			revelationPlace: "makkah",
		},
	];
	return {
		uthmani: vi.fn(() => Promise.resolve({ default: uthmaniAyahs })),
		indopak: vi.fn(() => Promise.resolve({ default: [] as Ayah[] })),
		clearquran: vi.fn(() => Promise.resolve({ default: clearQuran })),
		surahs: vi.fn(() => Promise.resolve({ default: surahs })),
	};
}

describe("CoreLoader", () => {
	it("does not import anything until first use", () => {
		const imports = makeImports();
		new CoreLoader(imports);
		expect(imports.uthmani).not.toHaveBeenCalled();
		expect(imports.indopak).not.toHaveBeenCalled();
		expect(imports.clearquran).not.toHaveBeenCalled();
		expect(imports.surahs).not.toHaveBeenCalled();
	});

	it("imports only the requested script, once, cached across calls", async () => {
		const imports = makeImports();
		const loader = new CoreLoader(imports);
		await loader.getScript("uthmani");
		await loader.getScript("uthmani");
		expect(imports.uthmani).toHaveBeenCalledTimes(1);
		expect(imports.indopak).not.toHaveBeenCalled();
	});

	it("unwraps a default export", async () => {
		const loader = new CoreLoader(makeImports());
		expect(await loader.getScript("uthmani")).toEqual([
			{ ayahKey: "1:1", surah: 1, ayah: 1, text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ" },
		]);
	});

	it("loads the Clear Quran translation and surah metadata", async () => {
		const loader = new CoreLoader(makeImports());
		expect(await loader.getClearQuranTranslation()).toEqual([
			{ ayahKey: "1:1", text: "In the Name of Allah—the Most Compassionate, Most Merciful." },
		]);
		expect((await loader.getSurahs())[0].nameEnglish).toBe("The Opening");
	});

	it("exposes static descriptors for the registry", () => {
		const loader = new CoreLoader(makeImports());
		expect(loader.listDescriptors().map((d) => d.id)).toEqual([
			CORE_UTHMANI_ID,
			CORE_INDOPAK_ID,
			CORE_CLEARQURAN_ID,
		]);
	});
});

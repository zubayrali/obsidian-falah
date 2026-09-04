import type { Ayah, ResourceDescriptor, TafsirVerse, TranslationVerse } from "../data/schema";
import type { SearchDocumentInput, SearchEdition } from "./types";

export function editionFromResource(resource: ResourceDescriptor): SearchEdition | undefined {
	if (resource.type !== "quran-script" && resource.type !== "translation" && resource.type !== "tafsir") {
		return undefined;
	}
	return {
		id: resource.id,
		name: resource.name,
		type: resource.type,
		language: resource.language,
	};
}

export function documentsFromAyahs(edition: SearchEdition, ayahs: readonly Ayah[]): SearchDocumentInput[] {
	return ayahs.map((ayah) => ({ edition, ayahKey: ayah.ayahKey, text: ayah.text }));
}

export function documentsFromTranslations(
	edition: SearchEdition,
	verses: readonly TranslationVerse[]
): SearchDocumentInput[] {
	return verses.map((verse) => ({ edition, ayahKey: verse.ayahKey, text: verse.text }));
}

export function documentsFromTafsirs(edition: SearchEdition, verses: readonly TafsirVerse[]): SearchDocumentInput[] {
	return verses.map((verse) => ({
		edition,
		ayahKey: verse.ayahKey,
		ayahKeys: verse.ayahKeys,
		text: verse.text,
	}));
}

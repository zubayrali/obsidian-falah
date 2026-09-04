import type { ArabicScript } from "./data/schema";
import type { BookmarkSort } from "./bookmarks/sort";
import { CORE_CLEARQURAN_ID } from "./data/core";
import { DEFAULT_FONT_BY_SCRIPT } from "./fonts";

export interface FalahSettings {
	translationEdition: string;
	tafsirEdition: string;
	arabicScript: ArabicScript;
	translationResourceId: string;
	tafsirResourceId: string;
	fontByScript: Record<string, string>;
	hadithSunnahApiKey: string;
	bookmarksPath: string;
	bookmarkDefaultCollection: string;
	bookmarkShowFavourites: boolean;
	bookmarkSort: BookmarkSort;
	bookmarkRecentCount: number;
	progressEnabled: boolean;
	progressPath: string;
	reciterId: string;
	wordResourceId: string;
	wordShowTranslation: boolean;
	wordShowTransliteration: boolean;
	wordAnalysisEnabled: boolean;
	wordInspectorGlass: boolean;
	wordInspectorDraggable: boolean;
	wordInspectorShowDictionary: boolean;
	wordInspectorShowGrammar: boolean;
	readerMaxWidth: number;
	readerAyahNumColor: string;
	readerTafsirColor: string;
	readerBismillahSize: number;
	readerTitleSize: number;
	readerHideScriptPicker: boolean;
	readerHideFontPicker: boolean;
	readerHideTafsirPicker: boolean;
	readerHideSizeButtons: boolean;
	readerHidePopout: boolean;
	readerHideNav: boolean;
}

export const DEFAULT_SETTINGS: FalahSettings = {
	translationEdition: "en.sahih",
	tafsirEdition: "",
	arabicScript: "uthmani",
	translationResourceId: CORE_CLEARQURAN_ID,
	tafsirResourceId: "",
	fontByScript: { ...DEFAULT_FONT_BY_SCRIPT },
	hadithSunnahApiKey: "",
	bookmarksPath: "Falah/bookmarks.json",
	bookmarkDefaultCollection: "Bookmarks",
	bookmarkShowFavourites: true,
	bookmarkSort: "added",
	bookmarkRecentCount: 5,
	progressEnabled: true,
	progressPath: "Falah/progress.json",
	reciterId: "alafasy",
	wordResourceId: "",
	wordShowTranslation: true,
	wordShowTransliteration: true,
	wordAnalysisEnabled: true,
	wordInspectorGlass: true,
	wordInspectorDraggable: true,
	wordInspectorShowDictionary: true,
	wordInspectorShowGrammar: true,
	readerMaxWidth: 720,
	readerAyahNumColor: "",
	readerTafsirColor: "",
	readerBismillahSize: 1.4,
	readerTitleSize: 1.3,
	readerHideScriptPicker: false,
	readerHideFontPicker: false,
	readerHideTafsirPicker: false,
	readerHideSizeButtons: false,
	readerHidePopout: false,
	readerHideNav: false,
};

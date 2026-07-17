// Every user-facing string in Falah. This is the source of truth: other locales
// are Partial<Strings>, so any key they omit falls back to English at merge time.
//
// Interpolation is a function per key, never concatenation at the call site —
// word order differs in RTL (Arabic) and in Urdu, and a call site that glues
// fragments together cannot be translated correctly.
export const en = {
	pluginName: "Falah",

	// -- Reader / commands --
	noticeOpenReaderFirst: "Open the Quran reader first",
	noticeUnsupportedReference: (uri: string) => `Unsupported Falah reference: ${uri}`,
	noticeNoReferenceUnderCursor: "No Islamic reference under cursor",

	// -- Insert / copy / refresh --
	noticeInsertedWithoutText: (reason: string) => `Inserted reference without text: ${reason}`,
	noticeReferenceTextCopied: "Reference text copied",
	noticeRefreshed: (label: string) => `${label} refreshed`,
	noticeCacheRefreshed: (label: string) => `${label} cache refreshed`,
	noticeCopied: "Copied",

	// -- Fonts --
	noticeFontDetectionUnavailable: "Font detection unavailable here — type the font name instead.",
	noticeFontsDetected: (count: number) => `Detected ${count} fonts.`,
	noticeFontAccessDenied: "Couldn't access system fonts (permission denied or unsupported).",
	noticeFontsReloaded: "Reloaded fonts.",

	// -- Resource library (download / import / remove) --
	noticeDownloadOrImportInProgress: "A download or import is already in progress",
	noticeImportedResources: (okCount: number, failed: string[]) =>
		`Imported ${okCount} resource(s)` + (failed.length ? `; failed: ${failed.join(", ")}` : ""),
	noticeResourceOperationInProgress: "Another resource operation is in progress",
	noticeRemoved: (name: string) => `Removed ${name}`,
	noticeDownloadCancelled: "Download cancelled",
	noticeInstalled: (name: string) => `${name} installed`,
	noticeDownloadFailed: (reason: string) => `Download failed: ${reason}`,
	noticeCacheCleared: "Falah cache cleared",

	// -- Ribbon --
	ribbonOpenReader: "Open Quran reader",

	// -- Commands --
	cmdOpenReader: "Open Quran reader",
	cmdPopOutReader: "Pop out Quran reader",
	cmdInsertQuran: "Insert Quran verse",
	cmdInsertHadith: "Insert hadith reference",
	cmdInsertHonorific: "Insert honorific",
	cmdOpenDetail: "Open Islamic reference detail",
	cmdCopyReferenceText: "Copy reference as text",
	cmdRefreshReference: "Refresh Islamic reference under cursor",

	// -- Settings: section headings --
	setHeadingCompanion: "Companion",
	setHeadingDisplay: "Display",
	setHeadingLibrary: "Library",
	setHeadingBrowseInstall: "Browse & install",
	setHeadingInstalledResources: "Installed resources",
	setHeadingManualImport: "Manual import",
	setHeadingHadithCollections: "Hadith collections",
	setHeadingInstalledHadithCollections: "Installed hadith collections",
	setHeadingAdvanced: "Advanced",

	// -- Settings: Display zone --
	setArabicScriptName: "Arabic script",
	setArabicScriptDesc: "Which script renders Quran text (both ship by default).",
	setPreferredTranslationName: "Preferred translation",
	setPreferredTranslationDesc: "Shown alongside the Arabic text.",
	setPreferredTafsirName: "Preferred tafsir",
	setPreferredTafsirDesc: "Shown alongside the Arabic text (none ship by default).",
	setUthmaniFontName: "Uthmani font",
	setIndopakFontName: "Indo-Pak font",
	setScriptFontDesc: "Applied to this script's Arabic in the reader and detail view.",
	setFontSourcesName: "Font sources",
	setFontSourcesDesc: (dir: string) =>
		`Detect installed fonts (desktop), or drop .ttf/.woff2 files into ${dir}/fonts and reload.`,

	// -- Settings: Library zone --
	setScanImportsName: "Scan imports folder",
	setScanImportsDesc: "Reads JSON packs dropped into the plugin's imports/ folder.",

	// -- Settings: Advanced zone --
	setOnlineFallbackTranslationName: "Online fallback translation edition",
	setOnlineFallbackTranslationDesc:
		"AlQuran.cloud edition used only when a reference isn't available locally, e.g. en.sahih, fr.hamidullah.",
	setOnlineFallbackTafsirName: "Online fallback tafsir edition",
	setOnlineFallbackTafsirDesc: "Optional AlQuran.cloud tafsir edition for the online fallback, e.g. ar.muyassar.",
	setClearCacheName: "Clear content cache",
	setClearCacheDesc: "Removes cached online-fallback responses. Downloaded/default resources are unaffected.",

	// -- Reader --
	readerDisplayName: "Quran",
	readerScriptUthmani: "Uthmani",
	readerScriptIndopak: "Indo-Pak",
	readerNoTranslation: "No translation",
	readerNoTafsir: "No tafsir",
	readerPopOutAriaLabel: "Pop out",
	readerLoading: "Loading…",
	readerVerseActions: "Verse actions",
	readerRemoveTafsirAriaLabel: "Remove tafsir",
	readerNoVerseActions: "No verse actions available",
	readerTafsirUnavailable: "Tafsir not available for this verse.",
	readerSurahOption: (number: number, nameEnglish: string) => `${number} · ${nameEnglish}`,
	readerResourceDefault: (name: string) => `${name} (default)`,
	readerSurahSubtitle: (nameArabic: string, ayahCount: number) => `${nameArabic} · ${ayahCount} ayahs`,
	readerTafsirBlockTitle: (name: string) => `Tafsir · ${name}`,
	readerTafsirThisVerse: (name: string) => `${name} (this verse)`,

	// -- Detail --
	detailLoading: "Loading…",
	detailSurah: (name: string) => `Surah ${name}`,
	detailTafsir: "Tafsir",
	detailPrevious: "← Previous",
	detailNext: "Next →",
	detailOpenInReader: "Open in reader",
	detailCopyArabic: "Copy Arabic",
	detailCopyTranslation: "Copy translation",
	detailCopyCitation: "Copy citation",
	detailNoText: "No text available from the provider.",
	detailOpenSource: "Open source ↗",

	// -- Suggest --
	suggestQuranVerse: "Quran verse…",
	suggestHadithReference: "Hadith reference…",
	suggestQuranSearchPlaceholder: "Search Quran text, or type a reference like 2:255 or 2:255-257",
	suggestQuranEmptyState: "No matching verses. Try a reference like 2:255.",
	suggestInsertThisReference: "Insert this reference",
	suggestHadithCollectionPlaceholder: "Pick a collection, or type a reference like bukhari:1",
	suggestCollectionsList: (names: string) => `Collections: ${names}`,
	suggestNoHadithCollections: "No hadith collections downloaded yet — install some in Settings.",
	suggestInsertRef: (ref: string) => `Insert ${ref}`,
	suggestTypeAReference: "Type a reference",
	suggestBundled: "bundled",
	suggestCollectionCount: (count: number, tierOrLanguage: string) => `${count} hadith · ${tierOrLanguage}`,
	suggestFilterCollectionPlaceholder: (name: string) => `Filter ${name} by number or text…`,
	suggestInsertHonorificPlaceholder: "Insert honorific",

	// -- Library / hadith (settings tab) --
	libraryLoadResourcesError: (msg: string) => `Couldn't load installed resources: ${msg}`,
	libraryCompanionTitle: "Tadabbur — reflection & journaling",
	libraryCompanionDesc:
		"Reflect on an ayah straight from the reader and write it to a per-ayah note or your daily note. " +
		"Falah then shows which of your notes reflect on each verse, and which verses you connect. " +
		"It's a separate plugin, so Falah stays a reader if that's all you want.",
	libraryGetTadabbur: "Get Tadabbur →",
	libraryScriptUthmaniOption: "Uthmani",
	libraryScriptIndopakOption: "Indo-Pak",
	libraryNoneOption: "None",
	libraryResourceDefault: (name: string) => `${name} (default)`,
	libraryCustomFontPlaceholder: "or type a system font…",
	libraryDetectFontsButton: "Detect installed fonts",
	libraryReloadFontsButton: "Reload vault fonts",
	libraryResourceSearchPlaceholder: "Search…",
	libraryTypeTranslationOption: "Translation",
	libraryTypeTafsirOption: "Tafsir",
	libraryRefreshButton: "Refresh",
	libraryAllLanguagesOption: "All languages",
	libraryLoading: "Loading…",
	libraryPickSourcePrompt: "Pick a source to browse resources.",
	libraryNoResourcesMatch: "No resources match your filters.",
	libraryNothingInstalled: "Nothing installed yet.",
	libraryRemoveButton: "Remove",
	libraryScanButton: "Scan",
	libraryHadithApiKeyPlaceholder: "sunnah.com API key",
	libraryLoadingCatalog: "Loading catalog…",
	libraryCachedCatalogOffline: "Showing cached catalog (offline)",
	libraryInstallButton: "Install",
	libraryDownloadingButton: "Downloading…",
	libraryInstalledHadithSummary: (name: string, count: number, source: string) =>
		`${name} · ${count} hadith · ${source}`,
	libraryInstalledTooltip: "Installed",
	libraryUpdateButton: "Update",
	libraryDownloadStarting: (name: string) => `${name}: starting…`,
	libraryCancelButton: "Cancel",
	libraryDownloadProgress: (name: string, done: number, total: number) => `${name}: ${done}/${total} surahs`,
	libraryClearButton: "Clear",
};

export type Strings = typeof en;

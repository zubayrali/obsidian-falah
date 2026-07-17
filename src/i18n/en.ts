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
};

export type Strings = typeof en;

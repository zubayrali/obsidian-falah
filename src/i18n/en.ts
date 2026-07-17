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
};

export type Strings = typeof en;

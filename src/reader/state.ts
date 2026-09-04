import type { ArabicScript } from "../data/schema";

export const DEFAULT_READER_FONT = 28;
export const MIN_READER_FONT = 16;
export const MAX_READER_FONT = 64;

export interface ReaderState {
	/** Reading is the distraction-free QCF Mushaf; study is the annotated reader. */
	mode?: "reading" | "study";
	/** Last Madinah Mushaf page, retained when switching back to Study mode. */
	page?: number;
	surah: number;
	ayah?: number;
	script: ArabicScript;
	translationId: string;
	tafsirId: string;
	compareIds: string[];
	fontSize: number;
	/** Use ordinary Unicode Arabic with the configured Uthmani font instead of
	 *  the page-specific QCF4 glyph face. QCF remains the page-accurate default. */
	readingTextFont?: boolean;
	/** Optional reader controls are disclosed from the header's settings button. */
	toolbarOptionsOpen?: boolean;
}

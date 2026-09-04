/**
 * U+06DF marks a silent letter in fully annotated Uthmani text. Some selectable
 * Quran fonts render it as an oversized baseline circle, so omit it from the
 * compact interactive-word UI while retaining it in the stored source text.
 * Older imported morphology packs represented the same mark as a literal `@`,
 * so accept that legacy spelling at the display boundary as well.
 */
export function arabicWordForDisplay(value: string): string {
	return value.replaceAll("۟", "").replaceAll("@", "");
}

/** Hide legacy corpus annotation tokens from romanized morphology labels. */
export function morphologyTransliterationForDisplay(value: string): string {
	return value.replaceAll("@", "");
}

// Pure font registry + helpers. NO asset imports and NO "obsidian" import, so
// vitest can load it. The bundled asset data-URIs and all DOM/injection live in
// font-loader.ts.

import type { ArabicScript } from "./data/schema";

export interface QuranFont {
	name: string; // display label
	family: string; // CSS family, matches the injected @font-face
	file: string; // bundled asset basename under assets/fonts/
	scripts: ArabicScript[]; // scripts this font suits (drives the pickers)
	attribution: string;
}

export const FALLBACK_FAMILY = "Noto Naskh Arabic";

export const BUNDLED_FONTS: QuranFont[] = [
	{
		name: "Amiri Quran",
		family: "Amiri Quran",
		file: "amiri-quran.woff2",
		scripts: ["uthmani"],
		attribution: "Amiri Quran — SIL OFL 1.1",
	},
	{
		name: "KFGQPC Uthmanic Hafs",
		family: "KFGQPC Uthmanic Hafs",
		file: "kfgqpc-hafs.woff2",
		scripts: ["uthmani"],
		attribution: "KFGQPC Uthmanic Hafs — King Fahd Complex (free for Qur'an use)",
	},
	{
		name: "PDMS Saleem (IndoPak)",
		family: "PDMS Saleem QuranFont",
		file: "pdms-saleem.ttf",
		scripts: ["indopak"],
		attribution: "PDMS Saleem QuranFont — free for Qur'an use",
	},
	{
		name: "Noto Naskh Arabic",
		family: "Noto Naskh Arabic",
		file: "noto-naskh.woff2",
		scripts: ["uthmani", "indopak"],
		attribution: "Noto Naskh Arabic — SIL OFL 1.1",
	},
];

export const DEFAULT_FONT_BY_SCRIPT: Record<string, string> = {
	uthmani: "Amiri Quran",
	indopak: "PDMS Saleem QuranFont",
};

/** CSS font-family stack for a family: the family, the naskh fallback, serif.
 *  Empty family (or the fallback itself) → just the fallback stack. */
export function fontStackFor(family: string): string {
	const parts =
		family && family !== FALLBACK_FAMILY
			? [`"${family}"`, `"${FALLBACK_FAMILY}"`, "serif"]
			: [`"${FALLBACK_FAMILY}"`, "serif"];
	return parts.join(", ");
}

export function bundledFontsForScript(script: ArabicScript): QuranFont[] {
	return BUNDLED_FONTS.filter((f) => f.scripts.includes(script));
}

/** De-duplicate + drop blanks + sort (for the enumerated OS-font list). */
export function dedupeFamilies(families: string[]): string[] {
	return [...new Set(families.filter((f) => typeof f === "string" && f.trim()))].sort((a, b) =>
		a.localeCompare(b)
	);
}

/** Vault font filename → family name: basename minus a font extension. */
export function familyFromFontFile(path: string): string {
	const base = path.split("/").pop() ?? path;
	return base.replace(/\.(woff2|woff|ttf|otf)$/i, "");
}

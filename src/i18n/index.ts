import { getLanguage } from "obsidian";
import { en, type Strings } from "./en";
import { ar } from "./ar";

/** Registered locale bundles. Add one file per locale and register it here;
 *  each is Partial<Strings>, so a half-finished translation is fine. */
const BUNDLES: Record<string, Partial<Strings>> = { ar };

/** Exact locale, else its base language, else nothing. `pt-BR` → `pt-br` → `pt`. */
export function resolveBundle(
	locale: string,
	bundles: Record<string, Partial<Strings>>
): Partial<Strings> {
	const key = locale.toLowerCase().replace(/_/g, "-");
	return bundles[key] ?? bundles[key.split("-")[0]] ?? {};
}

/** Pure: English overlaid with whatever the locale translates. */
export function buildStrings(
	locale: string,
	bundles: Record<string, Partial<Strings>> = BUNDLES
): Strings {
	return { ...en, ...resolveBundle(locale, bundles) };
}

/** Obsidian's UI language; fall back to the browser's.
 *  Defensive so it can't throw outside Obsidian or a window (tests, node). */
export function getLocale(): string {
	try {
		const browser = typeof window === "undefined" ? undefined : window.navigator?.language;
		return getLanguage() || browser || "en";
	} catch {
		return "en";
	}
}

let cached: Strings | undefined;

/** The accessor every call site uses: `t().someKey`. Resolved once — Obsidian
 *  requires a reload to change language, so there's nothing to invalidate. */
export function t(): Strings {
	if (!cached) cached = buildStrings(getLocale());
	return cached;
}

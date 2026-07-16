// Pure UI-glue helpers factored out of FalahSettingTab (src/main.ts) so they're
// testable without an Obsidian runtime. Nothing here imports "obsidian".

import type { DownloadSourceId, ResourceDescriptor, ResourceTier } from "./data/schema";

export const UPDATE_AVAILABLE_SUFFIX = " — update available";

/** Build dropdown-friendly {id, label} pairs for a catalog, appending a suffix
 *  to any resource whose id is in `updateIds` (spec §11 / §5.3, driven by
 *  Registry.updatesAvailable) so an installed-with-newer-version resource is
 *  visually distinguishable in the "Available resources" selector. */
export function annotateCatalogLabels(
	catalog: ResourceDescriptor[],
	updateIds: readonly string[]
): { id: string; label: string }[] {
	const updateSet = new Set(updateIds);
	return catalog.map((r) => ({
		id: r.id,
		label: updateSet.has(r.id) ? `${r.name}${UPDATE_AVAILABLE_SUFFIX}` : r.name,
	}));
}

/** Friendly, user-facing names for the download sources (spec: no raw ids in UI). */
export const SOURCE_LABELS: Record<DownloadSourceId, string> = {
	fawazahmed0: "fawazahmed0 (Quran CDN)",
	"alquran-cloud": "AlQuran.cloud",
	qul: "QUL",
};

/** Friendly tier words. The internal "bundled" tier reads as "default" in the UI. */
export const TIER_LABELS: Record<ResourceTier, string> = {
	bundled: "default",
	downloaded: "downloaded",
	"user-import": "imported",
};

/** ISO 639 code or a source's own language name → a human display name.
 *  QUL/AlQuran give ISO codes ("en"); fawazahmed0 gives lowercase names
 *  ("english"). Handles both; falls back to a title-cased input. */
export function languageDisplayName(lang: string): string {
	if (!lang) return "Unknown";
	if (/^[a-z]{2,3}$/i.test(lang)) {
		try {
			const name = new Intl.DisplayNames(["en"], { type: "language" }).of(lang.toLowerCase());
			if (name && name.toLowerCase() !== lang.toLowerCase()) return name;
		} catch {
			// Intl.DisplayNames unavailable or code rejected — fall through to title-case.
		}
	}
	return lang.charAt(0).toUpperCase() + lang.slice(1);
}

/** Distinct languages present in a catalog, as {value: raw, name: display} pairs,
 *  sorted by display name. `value` is the raw descriptor.language for exact-match
 *  filtering; one catalog comes from one source so raw values are format-consistent. */
export function distinctLanguages(catalog: ResourceDescriptor[]): { value: string; name: string }[] {
	const seen = new Map<string, string>();
	for (const r of catalog) {
		if (r.language && !seen.has(r.language)) seen.set(r.language, languageDisplayName(r.language));
	}
	return [...seen.entries()]
		.map(([value, name]) => ({ value, name }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Apply the browser's search (case-insensitive name substring) + language
 *  (exact raw-value match) filters. Both optional; combined with AND. */
export function filterCatalog(
	catalog: ResourceDescriptor[],
	opts: { search?: string; language?: string }
): ResourceDescriptor[] {
	const q = (opts.search ?? "").trim().toLowerCase();
	const lang = opts.language ?? "";
	return catalog.filter((r) => {
		if (lang && r.language !== lang) return false;
		if (q && !r.name.toLowerCase().includes(q)) return false;
		return true;
	});
}

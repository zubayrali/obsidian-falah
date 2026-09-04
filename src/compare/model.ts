import type { ResourceDescriptor } from "../data/schema";

export function editionAvailableForSurah(resource: ResourceDescriptor, surah: number): boolean {
	return resource.tier === "bundled" || resource.installedSurahs?.includes(surah) === true;
}

export interface EditionColumn {
	id: string;
	name: string;
	type: "translation" | "tafsir";
}

export interface ComparedAyah {
	ayahKey: string;
	values: Record<string, string | undefined>;
}

export interface EditionSelectionOptions {
	max?: number;
	maxTranslations?: number;
	maxTafsirs?: number;
}

export interface ComparisonLayout {
	mode: "columns" | "stacked";
	columnCount: number;
	minColumnWidth: number;
	overflow: "horizontal" | "none";
}

export function normalizeEditionSelection(
	ids: string[],
	available: EditionColumn[],
	options: number | EditionSelectionOptions = 4,
): string[] {
	const policy = typeof options === "number" ? { max: options } : options;
	const max = Math.max(0, policy.max ?? 4);
	const byId = new Map(available.map((edition) => [edition.id, edition]));
	const selected: string[] = [];
	let translationCount = 0;
	let tafsirCount = 0;

	for (const id of new Set(ids)) {
		const edition = byId.get(id);
		if (!edition || selected.length >= max) continue;
		if (edition.type === "translation") {
			if (translationCount >= (policy.maxTranslations ?? max)) continue;
			translationCount += 1;
		} else {
			if (tafsirCount >= (policy.maxTafsirs ?? max)) continue;
			tafsirCount += 1;
		}
		selected.push(id);
	}
	return selected;
}

export function alignEditions(
	ayahKeys: string[],
	editions: Array<{ id: string; verses: Array<{ ayahKey: string; ayahKeys?: string[]; text: string }> }>,
): ComparedAyah[] {
	const uniqueKeys = [...new Set(ayahKeys)];
	const rows = new Map<string, ComparedAyah>(
		uniqueKeys.map((ayahKey) => [ayahKey, { ayahKey, values: {} }]),
	);
	for (const edition of editions) {
		const values = new Map<string, string[]>();
		for (const verse of edition.verses) {
			const text = verse.text.trim();
			if (!text) continue;
			for (const key of new Set(verse.ayahKeys?.length ? verse.ayahKeys : [verse.ayahKey])) {
				if (!rows.has(key)) continue;
				const current = values.get(key) ?? [];
				if (!current.includes(text)) values.set(key, [...current, text]);
			}
		}
		for (const [key, texts] of values) {
			const row = rows.get(key);
			if (row) row.values[edition.id] = texts.join("\n\n");
		}
	}
	return uniqueKeys.map((key) => rows.get(key)).filter((row) => row !== undefined);
}

/** Responsive metadata; the UI decides how to express it in DOM/CSS. */
export function comparisonLayout(
	editionCount: number,
	viewportWidth: number,
	options: { mobileBreakpoint?: number; minColumnWidth?: number } = {},
): ComparisonLayout {
	const count = Math.max(1, Math.floor(editionCount));
	const mobileBreakpoint = options.mobileBreakpoint ?? 700;
	const minColumnWidth = options.minColumnWidth ?? 280;
	if (viewportWidth < mobileBreakpoint) {
		return { mode: "stacked", columnCount: 1, minColumnWidth, overflow: "none" };
	}
	return {
		mode: "columns",
		columnCount: count,
		minColumnWidth,
		overflow: count * minColumnWidth > viewportWidth ? "horizontal" : "none",
	};
}

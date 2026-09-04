import { alignEditions, type EditionColumn } from "../compare/model";
import { NotInstalledError, type ResourceDescriptor } from "../data/schema";
import type { QuranDataSource, SurahReading } from "../data/source";
import type { WordByWordDataAccess } from "../word-by-word/data-access";
import { arabicWordForDisplay } from "../word-by-word/display";
import { buildWordViewModels, type WordViewModel } from "../word-by-word/model";

export interface ComparisonRow {
	columns: EditionColumn[];
	values: Record<string, string | undefined>;
}

export interface WordDisplayOptions {
	resourceId: string;
	showTranslation: boolean;
	showTransliteration: boolean;
}

export interface ReaderEnhancements {
	comparisonRows: Map<string, ComparisonRow>;
	comparisonFailures: ComparisonFailure[];
	wordRows: Map<string, WordViewModel[]>;
	wordResourceMissing: boolean;
}

export interface ComparisonFailure {
	id: string;
	name: string;
	reason: "not-installed" | "unavailable";
}

export interface ReaderEnhancementSources {
	quran: Pick<QuranDataSource, "getTranslation" | "getTafsir">;
	words: Pick<WordByWordDataAccess, "listResources" | "readVerse">;
}

/** Load optional word and comparison data without coupling the view to storage details. */
export async function loadReaderEnhancements(
	reading: SurahReading,
	resources: ResourceDescriptor[],
	compareIds: string[],
	wordOptions: WordDisplayOptions | undefined,
	sources: ReaderEnhancementSources,
): Promise<ReaderEnhancements> {
	const [words, comparisons] = await Promise.all([
		loadWordRows(reading, wordOptions, sources.words),
		loadComparisonRows(reading, resources, compareIds, sources.quran),
	]);
	return {
		comparisonRows: comparisons.rows,
		comparisonFailures: comparisons.failures,
		wordRows: words.rows,
		wordResourceMissing: words.resourceMissing,
	};
}

async function loadWordRows(
	reading: SurahReading,
	options: WordDisplayOptions | undefined,
	source: Pick<WordByWordDataAccess, "listResources" | "readVerse">,
): Promise<{ rows: Map<string, WordViewModel[]>; resourceMissing: boolean }> {
	return loadWordRowsForAyahKeys(
		reading.ayahs.map((ayah) => ayah.ayahKey),
		options,
		source,
	);
}

/** Load the same word analysis used by Study mode for an arbitrary set of ayahs. */
export async function loadWordRowsForAyahKeys(
	ayahKeys: string[],
	options: WordDisplayOptions | undefined,
	source: Pick<WordByWordDataAccess, "listResources" | "readVerse">,
): Promise<{ rows: Map<string, WordViewModel[]>; resourceMissing: boolean }> {
	const rows = new Map<string, WordViewModel[]>();
	if (!options) return { rows, resourceMissing: false };
	const resources = await source.listResources();
	const installed = resources.some((resource) => resource.descriptor.id === options.resourceId && resource.installed);
	if (!installed) return { rows, resourceMissing: true };
	const verses = await Promise.all([...new Set(ayahKeys)].map((ayahKey) => source.readVerse(options.resourceId, ayahKey)));
	for (const verse of verses) {
		if (!verse) continue;
		rows.set(verse.ayahKey, buildWordViewModels(verse, {
			showTranslation: options.showTranslation,
			showTransliteration: options.showTransliteration,
		}));
	}
	return { rows, resourceMissing: false };
}

async function loadComparisonRows(
	reading: SurahReading,
	resources: ResourceDescriptor[],
	compareIds: string[],
	source: Pick<QuranDataSource, "getTranslation" | "getTafsir">,
): Promise<{ rows: Map<string, ComparisonRow>; failures: ComparisonFailure[] }> {
	const rows = new Map<string, ComparisonRow>();
	const failures: ComparisonFailure[] = [];
	if (!compareIds.length) return { rows, failures };
	const selected = resources.filter((resource) =>
		compareIds.includes(resource.id) && (resource.type === "translation" || resource.type === "tafsir"));
	const from = `${reading.surah.number}:1`;
	const to = `${reading.surah.number}:${reading.surah.ayahCount}`;
	const editions = (await Promise.all(selected.map(async (resource) => {
		try {
			const verses = resource.type === "translation"
				? await source.getTranslation(resource.id, from, to)
				: await source.getTafsir(resource.id, from, to);
			return { id: resource.id, verses };
		} catch (error) {
			failures.push({
				id: resource.id,
				name: resource.name,
				reason: error instanceof NotInstalledError ? "not-installed" : "unavailable",
			});
			return undefined;
		}
	}))).filter((edition) => edition !== undefined);
	const columns: EditionColumn[] = selected.map((resource) => ({
		id: resource.id,
		name: resource.name,
		type: resource.type as "translation" | "tafsir",
	}));
	for (const row of alignEditions(reading.ayahs.map((ayah) => ayah.ayahKey), editions)) {
		rows.set(row.ayahKey, { columns, values: row.values });
	}
	return { rows, failures };
}

export function renderInteractiveArabic(
	container: HTMLElement,
	words: WordViewModel[] | undefined,
	onSelect?: (word: WordViewModel, anchor: HTMLElement) => void,
): boolean {
	if (!words?.length) return false;
	container.addClass("falah-reader-arabic-interactive");
	for (const word of words) {
		const displayArabic = arabicWordForDisplay(word.arabic);
		const element = container.createEl("button", {
			cls: "falah-reader-word",
			attr: {
				type: "button",
				"data-word-position": String(word.position),
			},
		});
		element.createSpan({ cls: "falah-reader-word-arabic", text: displayArabic });
		if (word.gloss) element.createSpan({ cls: "falah-reader-word-sr-gloss", text: `: ${word.gloss}` });
		element.onclick = () => onSelect?.(word, element);
	}
	return true;
}

export function renderComparisonGrid(row: HTMLElement, comparison: ComparisonRow | undefined): void {
	if (!comparison?.columns.length) return;
	const grid = row.createDiv({ cls: "falah-reader-comparison" });
	for (const column of comparison.columns) {
		const value = comparison.values[column.id];
		if (!value) continue;
		const cell = grid.createDiv({ cls: "falah-reader-comparison-cell" });
		cell.createDiv({ cls: "falah-reader-comparison-title", text: column.name });
		cell.createDiv({ cls: "falah-reader-comparison-text", text: value });
	}
}

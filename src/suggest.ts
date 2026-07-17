// Slash-command suggest (/quran, /hadith, honorifics) plus the search modals
// that turn a provider result into an inserted canonical reference.

import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	SuggestModal,
	TFile,
} from "obsidian";
import { parseShorthand, toLabel } from "./ref";
import type { HadithRef } from "./ref";
import type { QuranSearchResult } from "./providers";
import { errMsg } from "./providers";
import { logMessage } from "./log";
import { filterHadiths } from "./data/hadith/browse";
import type { NormHadith } from "./data/hadith/schema";
import type { BrowsableCollection } from "./data/hadith/source";
import type FalahPlugin from "./main";
import { t } from "./i18n";

export interface Honorific {
	insert: string;
	label: string;
	keywords: string;
}

export const HONORIFICS: Honorific[] = [
	{ insert: "ﷺ", label: "ﷺ  ṣallallāhu ʿalayhi wa sallam", keywords: "saw saws pbuh prophet salla" },
	{ insert: "ﷻ", label: "ﷻ  jalla jalāluhu", keywords: "allah jalla" },
	{ insert: "سُبْحَانَهُ وَتَعَالَىٰ", label: "سبحانه وتعالى  subḥānahu wa taʿālā", keywords: "swt allah subhanahu" },
	{ insert: "عَزَّ وَجَلَّ", label: "عز وجل  ʿazza wa jall", keywords: "azza wajal allah" },
	{ insert: "عَلَيْهِ ٱلسَّلَامُ", label: "عليه السلام  ʿalayhi as-salām", keywords: "as prophet peace alayhi" },
	{ insert: "رَضِيَ ٱللَّهُ عَنْهُ", label: "رضي الله عنه  raḍiyallāhu ʿanhu", keywords: "ra companion male radiallahu" },
	{ insert: "رَضِيَ ٱللَّهُ عَنْهَا", label: "رضي الله عنها  raḍiyallāhu ʿanhā", keywords: "ra companion female radiallahu" },
	{ insert: "رَضِيَ ٱللَّهُ عَنْهُمْ", label: "رضي الله عنهم  raḍiyallāhu ʿanhum", keywords: "ra companions plural radiallahu" },
	{ insert: "رَحِمَهُ ٱللَّهُ", label: "رحمه الله  raḥimahullāh", keywords: "rah mercy scholar male rahimahullah" },
	{ insert: "رَحِمَهَا ٱللَّهُ", label: "رحمها الله  raḥimahallāh", keywords: "rah mercy scholar female rahimahallah" },
];

type SlashItem =
	| { type: "quran" | "hadith"; label: string; keywords: string }
	| { type: "honorific"; honorific: Honorific; label: string; keywords: string };

/** Built lazily (not a module-level constant) so it always reflects the current
 *  locale — Obsidian may not have its localStorage-backed language ready yet at
 *  module-import time. */
function baseItems(): SlashItem[] {
	return [
		{ type: "quran", label: t().suggestQuranVerse, keywords: "quran ayah verse surah" },
		{ type: "hadith", label: t().suggestHadithReference, keywords: "hadith sunnah bukhari muslim" },
		...HONORIFICS.map((h) => ({
			type: "honorific" as const,
			honorific: h,
			label: h.label,
			keywords: "honorific " + h.keywords,
		})),
	];
}

export class SlashSuggest extends EditorSuggest<SlashItem> {
	constructor(private plugin: FalahPlugin) {
		super(plugin.app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const m = /(?:^|[\s>([{])\/([a-z0-9]*)$/i.exec(before);
		if (!m) return null;
		return {
			start: { line: cursor.line, ch: cursor.ch - m[1].length - 1 },
			end: cursor,
			query: m[1].toLowerCase(),
		};
	}

	getSuggestions(ctx: EditorSuggestContext): SlashItem[] {
		const q = ctx.query;
		return baseItems().filter(
			(i) => !q || i.label.toLowerCase().includes(q) || i.keywords.includes(q)
		);
	}

	renderSuggestion(item: SlashItem, el: HTMLElement): void {
		el.createDiv({ text: item.label });
	}

	selectSuggestion(item: SlashItem, _evt: MouseEvent | KeyboardEvent): void {
		const ctx = this.context;
		if (!ctx) return;
		const { editor, start, end } = ctx;
		this.close();
		if (item.type === "honorific") {
			const text = item.honorific.insert + " ";
			editor.replaceRange(text, start, end);
			editor.setCursor({ line: start.line, ch: start.ch + text.length });
			return;
		}
		editor.replaceRange("", start, end);
		if (item.type === "quran") new QuranSearchModal(this.plugin, editor).open();
		else new HadithCollectionPickerModal(this.plugin, editor).open();
	}
}

export class QuranSearchModal extends SuggestModal<QuranSearchResult> {
	constructor(private plugin: FalahPlugin, private editor: Editor) {
		super(plugin.app);
		this.setPlaceholder(t().suggestQuranSearchPlaceholder);
		this.emptyStateText = t().suggestQuranEmptyState;
	}

	async getSuggestions(query: string): Promise<QuranSearchResult[]> {
		const q = query.trim();
		if (!q) return [];
		const ref = parseShorthand(q);
		if (ref?.kind === "quran") return [{ ref, snippet: t().suggestInsertThisReference }];
		if (q.length < 3) return [];
		try {
			return await this.plugin.liveApi.searchQuran(q);
		} catch {
			return [];
		}
	}

	renderSuggestion(r: QuranSearchResult, el: HTMLElement): void {
		el.createDiv({
			cls: "falah-suggest-title",
			text: toLabel(r.ref) + (r.surahName ? ` — ${r.surahName}` : ""),
		});
		el.createDiv({ cls: "falah-suggest-snippet", text: r.snippet });
	}

	onChooseSuggestion(r: QuranSearchResult): void {
		void this.plugin.insertReference(this.editor, r.ref);
	}
}

type PickerItem =
	| { kind: "ref"; ref: HadithRef }
	| { kind: "collection"; browsable: BrowsableCollection };

/** Step 1 of browse-to-insert: pick an installed/bundled collection, or fast-path
 *  a typed `collection:number` reference. */
export class HadithCollectionPickerModal extends SuggestModal<PickerItem> {
	private browsables: BrowsableCollection[] = [];

	constructor(private plugin: FalahPlugin, private editor: Editor) {
		super(plugin.app);
		this.setPlaceholder(t().suggestHadithCollectionPlaceholder);
		void this.plugin.hadith.listBrowsable().then((b) => {
			this.browsables = b;
			this.emptyStateText = b.length
				? t().suggestCollectionsList(b.map((x) => x.collection).join(", "))
				: t().suggestNoHadithCollections;
		});
	}

	getSuggestions(query: string): PickerItem[] {
		const items: PickerItem[] = [];
		const parsed = parseShorthand(query.trim());
		if (parsed && parsed.kind === "hadith") items.push({ kind: "ref", ref: parsed });
		const q = query.trim().toLowerCase();
		for (const b of this.browsables) {
			if (!q || b.collection.includes(q) || b.name.toLowerCase().includes(q)) {
				items.push({ kind: "collection", browsable: b });
			}
		}
		return items;
	}

	renderSuggestion(item: PickerItem, el: HTMLElement): void {
		if (item.kind === "ref") {
			el.createDiv({ cls: "falah-suggest-title", text: t().suggestInsertRef(toLabel(item.ref)) });
			el.createDiv({ cls: "falah-suggest-snippet", text: t().suggestTypeAReference });
			return;
		}
		const b = item.browsable;
		el.createDiv({ cls: "falah-suggest-title", text: b.name });
		el.createDiv({
			cls: "falah-suggest-snippet",
			text: t().suggestCollectionCount(b.count, b.tier === "bundled" ? t().suggestBundled : b.language),
		});
	}

	onChooseSuggestion(item: PickerItem): void {
		if (item.kind === "ref") {
			void this.plugin.insertReference(this.editor, item.ref);
			return;
		}
		new HadithBrowseModal(this.plugin, this.editor, item.browsable).open();
	}
}

/** Step 2: browse/filter the chosen collection and insert a reference. */
export class HadithBrowseModal extends SuggestModal<NormHadith> {
	private loading: Promise<{ hadiths: NormHadith[] }>;

	constructor(
		private plugin: FalahPlugin,
		private editor: Editor,
		private browsable: BrowsableCollection
	) {
		super(plugin.app);
		this.setPlaceholder(t().suggestFilterCollectionPlaceholder(browsable.name));
		this.loading = this.plugin.hadith.getCollection(browsable.id).catch((e) => {
			logMessage(errMsg(e), "error");
			this.close();
			return { hadiths: [] };
		});
	}

	async getSuggestions(query: string): Promise<NormHadith[]> {
		const col = await this.loading;
		return filterHadiths(col.hadiths, query, 50);
	}

	renderSuggestion(h: NormHadith, el: HTMLElement): void {
		const chapter = h.chapter?.english || h.chapter?.arabic;
		el.createDiv({
			cls: "falah-suggest-title",
			text: `#${h.number}${chapter ? " · " + chapter : ""}`,
		});
		const snippet = h.translation || h.arabic || "";
		el.createDiv({ cls: "falah-suggest-snippet", text: snippet.slice(0, 140) });
	}

	onChooseSuggestion(h: NormHadith): void {
		void this.plugin.insertReference(this.editor, {
			kind: "hadith",
			collection: this.browsable.collection,
			number: String(h.number),
		});
	}
}

export class HonorificModal extends SuggestModal<Honorific> {
	constructor(plugin: FalahPlugin, private editor: Editor) {
		super(plugin.app);
		this.setPlaceholder(t().suggestInsertHonorificPlaceholder);
	}

	getSuggestions(query: string): Honorific[] {
		const q = query.trim().toLowerCase();
		return HONORIFICS.filter(
			(h) => !q || h.label.toLowerCase().includes(q) || h.keywords.includes(q)
		);
	}

	renderSuggestion(h: Honorific, el: HTMLElement): void {
		el.createDiv({ text: h.label });
	}

	onChooseSuggestion(h: Honorific): void {
		const cursor = this.editor.getCursor();
		const text = h.insert + " ";
		this.editor.replaceRange(text, cursor);
		this.editor.setCursor({ line: cursor.line, ch: cursor.ch + text.length });
	}
}

import { SuggestModal, type App } from "obsidian";
import type { OfflineQuranSearchIndex } from "./index";
import type { SearchHit, SearchScope } from "./types";

export interface OfflineSearchModalOptions {
	app: App;
	index: OfflineQuranSearchIndex;
	navigate: (surah: number, ayah: number) => void | Promise<void>;
	scope?: SearchScope;
	placeholder?: string;
}

export class OfflineSearchModal extends SuggestModal<SearchHit> {
	private searchScope: SearchScope;
	constructor(private options: OfflineSearchModalOptions) {
		super(options.app);
		this.searchScope = options.scope ?? {};
		this.setPlaceholder(options.placeholder ?? "Search installed Quran text…");
		this.setInstructions([{ command: "↵", purpose: "open verse" }, { command: "esc", purpose: "close" }]);
	}

	async onOpen(): Promise<void> {
		await super.onOpen();
		const editions = this.options.index.editions();
		const controls = createDiv({ cls: "falah-search-scope" });
		const edition = controls.createEl("select", { cls: "dropdown" });
		edition.createEl("option", { value: "", text: "All installed editions" });
		for (const item of editions) edition.createEl("option", { value: item.id, text: item.name });
		const language = controls.createEl("select", { cls: "dropdown" });
		language.createEl("option", { value: "", text: "All languages" });
		for (const lang of [...new Set(editions.map((item) => item.language).filter((item) => item !== undefined))].sort()) {
			language.createEl("option", { value: lang, text: lang });
		}
		const refresh = () => {
			this.searchScope = {
				...this.options.scope,
				editionIds: edition.value ? [edition.value] : undefined,
				languages: language.value ? [language.value] : undefined,
			};
			this.inputEl.dispatchEvent(new Event("input"));
		};
		edition.onchange = refresh;
		language.onchange = refresh;
		this.inputEl.parentElement?.after(controls);
	}

	getSuggestions(query: string): SearchHit[] {
		return this.options.index.search(query, { scope: this.searchScope, limit: 75 });
	}

	renderSuggestion(hit: SearchHit, el: HTMLElement): void {
		el.createDiv({ cls: "falah-suggest-title", text: `${hit.surah}:${hit.ayah} · ${hit.edition.name}` });
		const snippet = el.createDiv({ cls: "falah-suggest-snippet" });
		let cursor = 0;
		for (const match of hit.snippet.matches) {
			if (match.start > cursor) snippet.createSpan({ text: hit.snippet.text.slice(cursor, match.start) });
			snippet.createEl("mark", { text: hit.snippet.text.slice(match.start, match.end) });
			cursor = match.end;
		}
		if (cursor < hit.snippet.text.length) snippet.createSpan({ text: hit.snippet.text.slice(cursor) });
	}

	onChooseSuggestion(hit: SearchHit): void {
		void this.options.navigate(hit.surah, hit.ayah);
	}
}

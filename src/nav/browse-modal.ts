import { Modal, type App } from "obsidian";
import type { Surah } from "../data/schema";
import {
	BROWSE_TABS,
	DEFAULT_BROWSE_LABELS,
	buildBrowseRows,
	type BrowseLabels,
	type BrowseRow,
	type BrowseTab,
} from "./browse";
import type { QuranNav } from "./schema";

export interface BrowseModalData {
	surahs: Surah[];
	nav: QuranNav;
}

export interface QuranBrowseModalOptions {
	app: App;
	load: () => BrowseModalData | Promise<BrowseModalData>;
	navigate: (surah: number, ayah: number) => void | Promise<void>;
	title?: string;
	loadingText?: string;
	errorText?: (error: unknown) => string;
	labels?: BrowseLabels;
	initialTab?: BrowseTab;
}

/** Browse Surahs, Juz, Pages, and Sajdah locations from one keyboard-friendly modal. */
export class QuranBrowseModal extends Modal {
	private readonly labels: BrowseLabels;
	private activeTab: BrowseTab;
	private data?: BrowseModalData;
	private loadGeneration = 0;

	constructor(private readonly options: QuranBrowseModalOptions) {
		super(options.app);
		this.labels = options.labels ?? DEFAULT_BROWSE_LABELS;
		this.activeTab = options.initialTab ?? "surahs";
	}

	onOpen(): void {
		const generation = ++this.loadGeneration;
		this.titleEl.setText(this.options.title ?? "Browse Quran");
		this.modalEl.addClass("falah-quran-browse-modal");
		this.renderLoading();
		void Promise.resolve(this.options.load()).then(
			(data) => {
				if (generation !== this.loadGeneration) return;
				this.data = data;
				this.render();
			},
			(error: unknown) => {
				if (generation !== this.loadGeneration) return;
				this.renderError(error);
			},
		);
	}

	onClose(): void {
		++this.loadGeneration;
		this.data = undefined;
		this.contentEl.empty();
	}

	private renderLoading(): void {
		this.contentEl.empty();
		this.contentEl.createDiv({ cls: "falah-loading", text: this.options.loadingText ?? "Loading Quran index…" });
	}

	private renderError(error: unknown): void {
		this.contentEl.empty();
		const fallback = error instanceof Error ? error.message : String(error);
		this.contentEl.createDiv({
			cls: "falah-error",
			text: this.options.errorText?.(error) ?? `Could not load the Quran index: ${fallback}`,
		});
	}

	private render(): void {
		if (!this.data) return;
		this.contentEl.empty();

		const tabs = this.contentEl.createDiv({ cls: "falah-quran-browse-tabs" });
		tabs.setAttribute("role", "tablist");
		for (const tab of BROWSE_TABS) {
			const selected = tab === this.activeTab;
			const button = tabs.createEl("button", {
				cls: `falah-quran-browse-tab${selected ? " is-active" : ""}`,
				text: this.labels.tab[tab],
			});
			button.type = "button";
			button.setAttribute("role", "tab");
			button.setAttribute("aria-selected", String(selected));
			button.onclick = () => {
				this.activeTab = tab;
				this.render();
			};
		}

		const list = this.contentEl.createDiv({ cls: "falah-quran-browse-list" });
		list.setAttribute("role", "tabpanel");
		for (const row of buildBrowseRows(this.activeTab, this.data.surahs, this.data.nav, this.labels)) {
			this.renderRow(list, row);
		}
	}

	private renderRow(parent: HTMLElement, row: BrowseRow): void {
		const button = parent.createEl("button", { cls: "falah-quran-browse-row" });
		button.type = "button";
		button.createDiv({ cls: "falah-suggest-title", text: row.label });
		if (row.sublabel) button.createDiv({ cls: "falah-suggest-snippet", text: row.sublabel });
		button.onclick = () => {
			this.close();
			void this.options.navigate(row.surah, row.ayah);
		};
	}
}

import { Setting } from "obsidian";
import type FalahPlugin from "../main";
import type { HadithCatalogEntry, HadithCollectionDescriptor } from "../data/hadith/schema";
import type { HadithSource } from "../data/hadith/sources";
import { errMsg } from "../providers";
import { logMessage } from "../log";
import { t } from "../i18n";
import { confirmAction } from "./confirm";
import { mergeHadithCollections } from "./library-items";
import { languageDisplayName } from "../settings-helpers";

function sourceLabel(id: string): string {
	const labels: Record<string, string> = {
		fawazahmed0: t().libraryHadithSourceFawaz,
		ahmedbaset: t().libraryHadithSourceAhmedBaset,
		sunnah: t().libraryHadithSourceSunnah,
		mhashim6: t().libraryHadithSourceMhashim,
		"hadith-unlocked": "Hadith Unlocked",
	};
	return labels[id] ?? id;
}

function resourceId(entry: HadithCatalogEntry, language: string): string {
	return `${entry.source}-${entry.collection}-${language}`;
}

export class HadithLibraryZone {
	private sourceId = "";
	private search = "";
	private catalog: HadithCatalogEntry[] = [];
	private stale = false;
	private fetched = false;
	private loading = false;
	private busy = false;
	private activeDownload?: AbortController;
	private catalogEpoch = 0;
	private redrawCatalog?: () => Promise<void>;

	constructor(
		private readonly plugin: FalahPlugin,
		private readonly rerender: () => Promise<void>,
	) {}

	render(containerEl: HTMLElement): void {
		const box = containerEl.createDiv({ cls: "falah-hadith-library" });
		const overview = box.createDiv({ cls: "falah-library-overview" });
		const filters = box.createDiv({ cls: "falah-filter-bar" });
		const sourceField = filters.createEl("label", { cls: "falah-library-field" });
		sourceField.createSpan({ text: t().libraryHadithSourceLabel, cls: "falah-library-field-label" });
		const sourceSelect = sourceField.createEl("select", { cls: "dropdown" });
		sourceSelect.createEl("option", { value: "", text: t().libraryAllSources });
		for (const source of this.plugin.hadithSources) {
			sourceSelect.createEl("option", { value: source.id, text: sourceLabel(source.id) });
		}
		if (this.sourceId && !this.plugin.hadithSources.some((source) => source.id === this.sourceId)) {
			this.sourceId = "";
		}
		sourceSelect.value = this.sourceId;

		const searchField = filters.createEl("label", { cls: "falah-library-field is-search" });
		searchField.createSpan({ text: t().libraryHadithSearchLabel, cls: "falah-library-field-label" });
		const searchInput = searchField.createEl("input", {
			type: "search",
			attr: { "aria-label": t().libraryHadithSearchLabel },
		});
		searchInput.placeholder = t().libraryHadithSearchPlaceholder;
		searchInput.value = this.search;
		const refresh = filters.createEl("button", { text: t().libraryRefreshButton, cls: "falah-refresh" });

		const sourceOptions = box.createDiv({ cls: "falah-hadith-source-options" });
		const listEl = box.createDiv({ cls: "falah-hadith-list" });
		const status = box.createDiv({ cls: "falah-library-status", attr: { "aria-live": "polite" } });

		const selectedSource = (): HadithSource | undefined =>
			this.plugin.hadithSources.find((source) => source.id === this.sourceId);

		const renderSourceOptions = () => {
			sourceOptions.empty();
			if (!selectedSource()?.needsApiKey) return;
			new Setting(sourceOptions)
				.setName(t().libraryHadithApiKeyName)
				.setDesc(t().libraryHadithApiKeyDesc)
				.addText((text) => {
					text.inputEl.type = "password";
					text.setPlaceholder(t().libraryHadithApiKeyPlaceholder)
						.setValue(this.plugin.settings.hadithSunnahApiKey ?? "")
						.onChange(async (value) => {
							this.plugin.settings.hadithSunnahApiKey = value.trim();
							await this.plugin.persist();
						});
				});
		};

		const renderCatalog = async () => {
			const descriptors = await this.plugin.hadith.listInstalled();
			refresh.disabled = this.loading;
			listEl.empty();
			overview.empty();
			overview.createSpan({ text: t().libraryHadithInstalledCount(descriptors.length), cls: "falah-library-count" });
			if (this.loading) {
				const loading = listEl.createDiv({ cls: "falah-library-state is-loading", attr: { role: "status" } });
				loading.createSpan({ cls: "falah-library-spinner" });
				loading.createSpan({ text: t().libraryLoadingCatalog });
			}
			if (this.stale) {
				const warning = listEl.createDiv({ cls: "falah-library-state is-warning", attr: { role: "status" } });
				warning.setText(this.catalog.length ? t().libraryCachedCatalogOffline : t().libraryCatalogError);
			}
			const query = this.search.trim().toLocaleLowerCase();
			const entries = mergeHadithCollections(this.catalog, descriptors).filter((entry) => (!this.sourceId || entry.source === this.sourceId) && (!query ||
				entry.name.toLocaleLowerCase().includes(query) || entry.collection.toLocaleLowerCase().includes(query)));
			overview.querySelector(".falah-hadith-catalog-count")?.remove();
			overview.createSpan({
				text: t().libraryHadithCatalogCount(entries.length),
				cls: "falah-library-count falah-hadith-catalog-count",
			});
			if (!entries.length) {
				listEl.createEl("p", { text: t().libraryHadithNoMatch, cls: "falah-muted" });
				return;
			}
			const installed = new Set(descriptors.map((descriptor) => descriptor.id));
			for (const entry of entries) this.renderCatalogRow(listEl, entry, installed, status);
		};

		const loadCatalog = async (force = false) => {
			const epoch = ++this.catalogEpoch;
			const sources = this.plugin.hadithSources.filter((source) => this.sourceId ? source.id === this.sourceId : !source.needsApiKey || Boolean(this.plugin.settings.hadithSunnahApiKey));
			this.loading = true;
			this.fetched = true;
			refresh.disabled = true;
			await renderCatalog();
			try {
				const results = await Promise.allSettled(sources.map((source) => this.plugin.hadithCatalog.get(source.id, () => source.listCatalog(this.plugin.fetchJson), { force })));
				if (epoch !== this.catalogEpoch) return;
				this.catalog = results.flatMap((result) => result.status === "fulfilled" ? result.value.resources : []);
				this.stale = results.some((result) => result.status === "rejected" || result.value.stale);
			} catch (error) {
				if (epoch !== this.catalogEpoch) return;
				this.catalog = [];
				this.stale = false;
				status.setAttr("role", "alert");
				status.setText(errMsg(error));
			} finally {
				if (epoch === this.catalogEpoch) {
				this.loading = false;
				refresh.disabled = false;
				await this.redrawCatalog?.();
				}
			}
		};

		sourceSelect.onchange = () => {
			this.sourceId = sourceSelect.value;
			this.catalog = [];
			this.fetched = false;
			this.search = "";
			searchInput.value = "";
			renderSourceOptions();
			void loadCatalog();
		};
		searchInput.oninput = () => {
			this.search = searchInput.value;
			void renderCatalog();
		};
		refresh.onclick = () => void loadCatalog(true);

		renderSourceOptions();
		this.redrawCatalog = renderCatalog;
		if (this.fetched) void renderCatalog();
		else void loadCatalog();
	}

	private renderCatalogRow(
		containerEl: HTMLElement,
		entry: HadithCatalogEntry,
		installed: Set<string>,
		status: HTMLElement,
	): void {
		const setting = new Setting(containerEl).setName(entry.name).setDesc(sourceLabel(entry.source));
		setting.settingEl.addClass("falah-hadith-collection-row");
		let language = entry.languages.find((value) => installed.has(resourceId(entry, value))) ?? entry.languages[0] ?? "ara";
		setting.addDropdown((dropdown) => {
			dropdown.selectEl.addClass("falah-hadith-language");
			dropdown.selectEl.setAttr("aria-label", `${t().libraryResourceLanguageLabel}: ${entry.name}`);
			for (const value of entry.languages) dropdown.addOption(value, languageDisplayName(value));
			dropdown.setValue(language).onChange((value) => {
				language = value;
				syncButton();
			});
		});
		let actionButton: HTMLButtonElement;
		const syncButton = () => {
			if (!actionButton) return;
			const isInstalled = installed.has(resourceId(entry, language));
			actionButton.setText(isInstalled ? t().libraryRemoveButton : t().libraryInstallButton);
			setting.setDesc([sourceLabel(entry.source), isInstalled ? t().libraryInstalledTooltip : ""].filter(Boolean).join(" · "));
		};
		setting.addButton((button) => {
			actionButton = button.buttonEl;
			button.setDisabled(this.busy).onClick(async () => {
				const id = resourceId(entry, language);
				if (installed.has(id)) {
					const descriptor = (await this.plugin.hadith.listInstalled()).find((item) => item.id === id);
					if (descriptor) await this.removeCollection(descriptor);
					return;
				}
				if (this.busy) return;
				const source = this.plugin.hadithSources.find((item) => item.id === entry.source);
				if (!source) return;
				const controller = new AbortController();
				this.activeDownload = controller;
				this.busy = true;
				actionButton.disabled = true;
				status.empty();
				status.setAttr("role", "status");
				status.createSpan({ text: t().libraryHadithDownloadStarting(entry.name) });
				const cancel = status.createEl("button", { text: t().libraryCancelButton, cls: "falah-cancel" });
				cancel.onclick = () => controller.abort();
				try {
					const transport = source.id === "mhashim6" ? this.plugin.hadithFetchText : this.plugin.fetchJson;
					const collection = await source.fetchCollection(entry.collection, language, transport, controller.signal);
					if (controller.signal.aborted) return;
					await this.plugin.hadith.install({
						id,
						source: entry.source,
						collection: entry.collection,
						language,
						name: entry.name,
						count: collection.hadiths.length,
					}, collection);
					installed.add(id);
					logMessage(t().libraryHadithInstalledNotice(entry.name), "info");
				} catch (error) {
					status.setAttr("role", "alert");
					status.setText(errMsg(error));
				} finally {
					this.activeDownload = undefined;
					this.busy = false;
					syncButton();
					await this.rerender();
				}
			});
			syncButton();
		});
	}

	private async removeCollection(descriptor: HadithCollectionDescriptor): Promise<void> {
		if (this.busy || !await confirmAction(this.plugin.app, {
			title: t().confirmRemoveResourceTitle,
			message: t().confirmRemoveResourceDesc(descriptor.name),
			confirmLabel: t().libraryRemoveButton,
			cancelLabel: t().libraryCancelButton,
		})) return;
		this.busy = true;
		try {
			await this.plugin.hadith.remove(descriptor.id);
			logMessage(t().libraryHadithRemovedNotice(descriptor.name), "info");
		} catch (error) {
			logMessage(errMsg(error), "error");
		} finally {
			this.busy = false;
			await this.rerender();
		}
	}

	dispose(): void {
		this.activeDownload?.abort();
	}
}

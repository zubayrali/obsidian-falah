import { Setting } from "obsidian";
import { LanguagePicker } from "./language-picker";
import type FalahPlugin from "../main";
import type { DownloadSourceId, ResourceDescriptor } from "../data/schema";
import { categoryForType } from "../data/store";
import { scanImportsFolder } from "../data/imports";
import { downloadResource } from "../data/download";
import { resourceMissingAyahs } from "../data/coverage";
import { errMsg } from "../providers";
import { logMessage } from "../log";
import { t } from "../i18n";
import {
	SOURCE_LABELS,
	TIER_LABELS,
	distinctLanguages,
	filterCatalog,
	languageDisplayName,
} from "../settings-helpers";
import { HadithLibraryZone } from "./hadith-library";
import {
	downloadWordAnalysis,
	WORD_ANALYSIS_DESCRIPTOR,
	WORD_ANALYSIS_RESOURCE_ID,
} from "../word-by-word/download";
import { RecitationLibraryZone } from "./recitation-library";
import { createSettingsPageIntro, createSettingsSection } from "./ui";
import { mergeQuranResources } from "./library-items";
import { confirmAction } from "./confirm";

type ResourceType = "translation" | "tafsir";

interface BrowseState {
	source: DownloadSourceId | "";
	type: ResourceType;
	catalog: ResourceDescriptor[];
	updateIds: Set<string>;
	search: string;
	language: string;
	loading: boolean;
	fetched: boolean;
	stale: boolean;
	error: string;
	visibleLimit: number;
}

export class LibraryZone {
	private category: "quran" | "hadith" | "audio" | "packs" | "import" = "quran";
	private catalogEpoch = 0;
	private redrawCatalog?: () => void;
	private busy = false;
	private activeDownload?: AbortController;
	private readonly recitations: RecitationLibraryZone;
	private readonly hadith: HadithLibraryZone;
	private readonly browse: BrowseState = {
		source: "",
		type: "translation",
		catalog: [],
		updateIds: new Set(),
		search: "",
		language: "",
		loading: false,
		fetched: false,
		stale: false,
		error: "",
		visibleLimit: 60,
	};

	constructor(
		private readonly plugin: FalahPlugin,
		private readonly rerender: () => Promise<void>,
	) {
		this.recitations = new RecitationLibraryZone(plugin, rerender);
		this.hadith = new HadithLibraryZone(plugin, rerender);
	}

	render(containerEl: HTMLElement, resources: ResourceDescriptor[]): void {
		createSettingsPageIntro(containerEl, t().setLibraryPageTitle, t().setLibraryPageDesc);
		const categories = [
			{ id: "quran" as const, label: t().setLibraryCategoryQuran },
			{ id: "hadith" as const, label: t().setLibraryCategoryHadith },
			{ id: "audio" as const, label: t().setLibraryCategoryAudio },
			{ id: "packs" as const, label: t().setLibraryCategoryPacks },
			{ id: "import" as const, label: t().setLibraryCategoryImport },
		];
		const nav = containerEl.createDiv({ cls: "falah-library-categories", attr: { role: "group", "aria-label": t().setLibraryPageTitle } });
		for (const category of categories) {
			const button = nav.createEl("button", {
				text: category.label,
				cls: this.category === category.id ? "is-active" : "",
				attr: { type: "button", "aria-pressed": String(this.category === category.id) },
			});
			button.onclick = () => {
				const root = containerEl.getRootNode() as Document | ShadowRoot;
				this.category = category.id;
				void this.rerender().then(() => {
					root.querySelector<HTMLButtonElement>('.falah-library-categories [aria-pressed="true"]')?.focus();
				});
			};
		}
		const installedById = new Map(resources.map((resource) => [resource.id, resource]));
		if (this.category === "audio") {
			const recitations = createSettingsSection(containerEl, {
				id: "library-recitations",
				title: t().libraryRecitationsHeading,
				description: t().libraryRecitationsDesc,
				icon: "headphones",
			});
			this.recitations.render(recitations);
		} else if (this.category === "packs") {
			const essentials = createSettingsSection(containerEl, {
				id: "library-reading-packs",
				title: t().setLibraryReadingPacksHeading,
				description: t().setLibraryReadingPacksDesc,
				icon: "package-open",
			});
			this.renderMushafInstaller(essentials);
			this.renderWordAnalysisInstaller(essentials, installedById.get(WORD_ANALYSIS_RESOURCE_ID));
		} else if (this.category === "quran") {
			const quranResources = createSettingsSection(containerEl, {
				id: "library-quran-resources",
				title: t().setLibraryQuranResourcesHeading,
				description: t().setLibraryQuranResourcesDesc,
				icon: "languages",
			});
			this.renderBrowser(quranResources, installedById);
		} else if (this.category === "hadith") {
			const hadith = createSettingsSection(containerEl, {
				id: "library-hadith",
				title: t().setHeadingHadithCollections,
				description: t().setLibraryHadithDesc,
				icon: "library-big",
			});
			this.hadith.render(hadith);
		} else {
			const manual = createSettingsSection(containerEl, {
				id: "library-manual-import",
				title: t().setHeadingManualImport,
				description: t().setLibraryManualImportDesc,
				icon: "folder-input",
			});
			this.renderManualImport(manual);
		}
	}

	private renderMushafInstaller(containerEl: HTMLElement): void {
		const setting = new Setting(containerEl)
			.setName(t().libraryMushafPackName)
			.setDesc(t().libraryMushafPackDesc);
		const status = setting.descEl.createDiv({ cls: "falah-muted" });
		void this.plugin.qcf.cacheStatus().then((cache) => {
			status.setText(t().libraryMushafPackCached(cache.pages, cache.fonts));
			if (cache.complete) {
				setting.addExtraButton((button) => button.setIcon("checkmark").setTooltip(t().libraryInstalledTooltip).setDisabled(true));
				return;
			}
			setting.addButton((button) => button
				.setButtonText(cache.pages || cache.fonts ? t().libraryMushafPackResume : t().libraryMushafPackInstall)
				.setCta()
				.onClick(async () => {
					if (this.busy) return;
					this.busy = true;
					button.setDisabled(true);
					const controller = new AbortController();
					this.activeDownload = controller;
					const cancel = setting.controlEl.createEl("button", { text: t().libraryCancelButton });
					cancel.onclick = () => controller.abort();
					try {
						await this.plugin.qcf.downloadComplete((done, total) => status.setText(`${done}/${total}`), controller.signal);
					} catch (error) {
						logMessage(errMsg(error), "error");
					} finally {
						this.activeDownload = undefined;
						this.busy = false;
						await this.rerender();
					}
				}));
		}).catch((error) => status.setText(errMsg(error)));
	}

	private renderWordAnalysisInstaller(containerEl: HTMLElement, installed: ResourceDescriptor | undefined): void {
		const complete = installed?.installedSurahs?.length === 114;
		const setting = new Setting(containerEl)
			.setName(t().libraryWordAnalysisName)
			.setDesc(t().libraryWordAnalysisDesc);
		if (complete) {
			setting.addExtraButton((button) => button
				.setIcon("checkmark")
				.setTooltip(t().libraryInstalledTooltip)
				.setDisabled(true));
			setting.addButton((button) => button
				.setButtonText(t().libraryWordAnalysisUse)
				.setDisabled(this.plugin.settings.wordResourceId === WORD_ANALYSIS_RESOURCE_ID)
				.onClick(async () => {
					this.plugin.settings.wordResourceId = WORD_ANALYSIS_RESOURCE_ID;
					await this.plugin.persist();
					this.plugin.refreshReader();
					await this.rerender();
				}));
			return;
		}

		setting.addButton((button) => button
			.setButtonText(installed ? t().libraryResumeButton : t().libraryWordAnalysisInstall)
			.setCta()
			.onClick(async () => {
				if (this.busy) return;
				this.busy = true;
				button.setDisabled(true);
				const progress = containerEl.createDiv({ cls: "falah-download-progress" });
				const label = progress.createSpan({ text: t().libraryDownloadStarting(WORD_ANALYSIS_DESCRIPTOR.name) });
				const controller = new AbortController();
				this.activeDownload = controller;
				const cancel = progress.createEl("button", { cls: "falah-cancel", text: t().libraryCancelButton });
				cancel.onclick = () => controller.abort();
				try {
					await downloadWordAnalysis({
						fetchText: async (url) => String(await this.plugin.hadithFetchText(url)),
						fetchJson: this.plugin.fetchJson,
						store: this.plugin.store,
						registry: this.plugin.registry,
					}, (value) => label.setText(t().libraryDownloadProgress(
						WORD_ANALYSIS_DESCRIPTOR.name,
						value.surahsDone,
						value.surahsTotal,
					)), controller.signal);
					if (!controller.signal.aborted) {
						this.plugin.settings.wordResourceId = WORD_ANALYSIS_RESOURCE_ID;
						await this.plugin.persist();
						this.plugin.refreshReader();
					}
				} catch (error) {
					logMessage(errMsg(error), "error");
				} finally {
					this.activeDownload = undefined;
					this.busy = false;
					progress.remove();
					await this.rerender();
				}
			}));
	}

	private renderBrowser(containerEl: HTMLElement, installedById: Map<string, ResourceDescriptor>): void {
		const overview = containerEl.createDiv({ cls: "falah-library-overview" });
		const bar = containerEl.createDiv({ cls: "falah-filter-bar" });
		const createField = (label: string) => {
			const field = bar.createEl("label", { cls: "falah-library-field" });
			field.createSpan({ text: label, cls: "falah-library-field-label" });
			return field;
		};
		const searchInput = createField(t().libraryResourceSearchLabel).createEl("input", {
			type: "search",
			cls: "falah-search",
			attr: { "aria-label": t().libraryResourceSearchLabel },
		});
		searchInput.placeholder = t().libraryResourceSearchPlaceholder;
		searchInput.value = this.browse.search;
		const languageSelect = createField(t().libraryResourceLanguageLabel)
			.createEl("button", { cls: "falah-language-picker", attr: { type: "button", "aria-haspopup": "dialog" } });
		const typeSelect = createField(t().libraryResourceTypeLabel).createEl("select", { cls: "dropdown" });
		typeSelect.createEl("option", { value: "translation", text: t().libraryTypeTranslationOption });
		typeSelect.createEl("option", { value: "tafsir", text: t().libraryTypeTafsirOption });
		typeSelect.value = this.browse.type;
		const sourceSelect = createField(t().libraryResourceSourceLabel).createEl("select", { cls: "dropdown" });
		sourceSelect.createEl("option", { value: "", text: t().libraryAllSources });
		for (const id of Object.keys(this.plugin.downloadSources) as DownloadSourceId[]) {
			sourceSelect.createEl("option", { value: id, text: SOURCE_LABELS[id] });
		}
		sourceSelect.value = this.browse.source;
		const refreshButton = bar.createEl("button", { text: t().libraryRefreshButton, cls: "falah-refresh" });
		refreshButton.setAttr("aria-label", t().libraryRefreshButton);

		const listEl = containerEl.createDiv({ cls: "falah-resource-list" });
		const progressEl = containerEl.createDiv({ cls: "falah-download-progress", attr: { "aria-live": "polite" } });

		const rebuildLanguageOptions = () => {
			languageSelect.setText(distinctLanguages(mergedResources()).find((item) => item.value === this.browse.language)?.name ?? t().libraryAllLanguagesOption);
			languageSelect.setAttr("aria-label", `${t().libraryResourceLanguageLabel}: ${languageSelect.textContent}`);
		};

		const mergedResources = () => mergeQuranResources(this.browse.catalog, [...installedById.values()])
			.filter((resource) => resource.type === this.browse.type && (!this.browse.source || resource.source === this.browse.source));
		const renderList = () => {
			listEl.empty();
			overview.empty();
				const installedCount = [...installedById.values()].filter((resource) =>
					resource.tier !== "bundled" && resource.cardinality !== "per-word" && (resource.type === "translation" || resource.type === "tafsir")).length;
			overview.createSpan({
				text: t().libraryQuranInstalledSummary(installedCount, this.browse.updateIds.size),
				cls: "falah-library-count",
			});
			if (this.browse.loading) {
				const loading = listEl.createDiv({ cls: "falah-library-state is-loading" });
				loading.setAttr("role", "status");
				loading.createSpan({ cls: "falah-library-spinner" });
				loading.createSpan({ text: t().libraryLoading });
			}
			if (!this.browse.fetched) {
				listEl.createEl("p", { text: t().libraryPickSourcePrompt, cls: "falah-muted" });
				return;
			}
			const filtered = filterCatalog(mergedResources(), {
				search: this.browse.search,
				language: this.browse.language,
			});
			if (this.browse.stale) {
				const stale = listEl.createDiv({ cls: "falah-library-state is-warning" });
				stale.setAttr("role", "status");
				stale.setText(this.browse.catalog.length ? t().libraryCatalogCached : t().libraryCatalogError);
			}
			if (this.browse.error) {
				const error = listEl.createDiv({ cls: "falah-library-state is-error" });
				error.setAttr("role", "alert");
				error.setText(this.browse.error);
			}
			if (!filtered.length) {
				listEl.createEl("p", { text: t().libraryNoResourcesMatch, cls: "falah-muted" });
				return;
			}
			overview.createSpan({ text: t().libraryCatalogCount(filtered.length), cls: "falah-library-count" });
			for (const descriptor of filtered.slice(0, this.browse.visibleLimit)) {
				this.renderResourceRow(listEl, descriptor, installedById.get(descriptor.id), progressEl);
			}
			const remaining = filtered.length - this.browse.visibleLimit;
			if (remaining > 0) {
				const more = listEl.createEl("button", {
					text: t().libraryShowMoreButton(remaining),
					cls: "falah-library-show-more",
				});
				more.onclick = () => {
					this.browse.visibleLimit += 60;
					renderList();
				};
			}
		};

		const fetchCatalog = async (force: boolean) => {
			const epoch = ++this.catalogEpoch;
			const selection = this.browse.source;
			const type = this.browse.type;
			this.browse.loading = true;
			this.browse.fetched = true;
			this.browse.error = "";
			refreshButton.disabled = true;
			renderList();
			try {
				const ids = selection ? [selection] : Object.keys(this.plugin.downloadSources) as DownloadSourceId[];
				const results = await Promise.allSettled(ids.map((id) => this.plugin.registry.getCatalog(id, type, () => this.plugin.downloadSources[id].listCatalog(type), { force })));
				if (epoch !== this.catalogEpoch) return;
				this.browse.catalog = results.flatMap((result) => result.status === "fulfilled" ? result.value.resources : []);
				this.browse.stale = results.some((result) => result.status === "rejected" || result.value.stale);
				this.browse.updateIds = new Set(await this.plugin.registry.updatesAvailable(this.browse.catalog));
			} catch (error) {
				if (epoch !== this.catalogEpoch) return;
				this.browse.catalog = [];
				this.browse.stale = false;
				this.browse.error = errMsg(error);
				logMessage(this.browse.error, "error");
			} finally {
				if (epoch === this.catalogEpoch) {
				this.browse.loading = false;
				refreshButton.disabled = false;
				this.redrawCatalog?.();
				}
			}
		};

		searchInput.addEventListener("input", () => {
			this.browse.search = searchInput.value;
			this.browse.visibleLimit = 60;
			renderList();
		});
		languageSelect.addEventListener("click", () => {
			new LanguagePicker(this.plugin.app, [
				{ value: "", name: t().libraryAllLanguagesOption },
				...distinctLanguages(mergedResources()),
			], (value) => {
				this.browse.language = value;
				this.browse.visibleLimit = 60;
				rebuildLanguageOptions();
				renderList();
			}, t().libraryResourceLanguageLabel).open();
		});
		typeSelect.addEventListener("change", () => {
			this.browse.type = typeSelect.value as ResourceType;
			this.browse.language = "";
			this.browse.visibleLimit = 60;
			void fetchCatalog(false);
		});
		sourceSelect.addEventListener("change", () => {
			this.browse.source = sourceSelect.value as DownloadSourceId;
			this.browse.language = "";
			this.browse.visibleLimit = 60;
			void fetchCatalog(false);
		});
		refreshButton.addEventListener("click", () => void fetchCatalog(true));

		this.redrawCatalog = () => { refreshButton.disabled = this.browse.loading; rebuildLanguageOptions(); renderList(); };
		rebuildLanguageOptions();
		if (this.browse.fetched) renderList();
		else void fetchCatalog(false);
	}

	private renderManualImport(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t().setScanImportsName)
			.setDesc(t().setScanImportsDesc)
			.addButton((button) => button.setButtonText(t().libraryScanButton).onClick(async () => {
				if (this.busy) {
					logMessage(t().noticeDownloadOrImportInProgress, "warn");
					return;
				}
				this.busy = true;
				button.setDisabled(true);
				try {
					const result = await scanImportsFolder({
						io: this.plugin.io,
						store: this.plugin.store,
						registry: this.plugin.registry,
					});
					logMessage(t().noticeImportedResources(result.ok.length, result.failed), "info");
					this.plugin.refreshReader();
					await this.rerender();
				} catch (error) {
					logMessage(errMsg(error), "error");
				} finally {
					this.busy = false;
					button.setDisabled(false);
				}
			}));
	}

	private async removeResource(resource: ResourceDescriptor): Promise<void> {
		if (this.busy) {
			logMessage(t().noticeResourceOperationInProgress, "warn");
			return;
		}
		if (!await confirmAction(this.plugin.app, {
			title: t().confirmRemoveResourceTitle,
			message: t().confirmRemoveResourceDesc(resource.name),
			confirmLabel: t().libraryRemoveButton,
			cancelLabel: t().libraryCancelButton,
		})) return;
		this.busy = true;
		try {
			await this.plugin.registry.removeResource(resource.id, categoryForType(resource.type));
			if (resource.id === this.plugin.settings.wordResourceId) {
				this.plugin.settings.wordResourceId = "";
				await this.plugin.persist();
			}
			logMessage(t().noticeRemoved(resource.name), "info");
			this.plugin.refreshReader();
			await this.rerender();
		} catch (error) {
			logMessage(errMsg(error), "error");
		} finally {
			this.busy = false;
		}
	}

	private renderResourceRow(
		listEl: HTMLElement,
		descriptor: ResourceDescriptor,
		installed: ResourceDescriptor | undefined,
		progressEl: HTMLElement,
	): void {
		const isUpdate = this.browse.updateIds.has(descriptor.id);
		const isComplete = installed?.installedSurahs?.length === 114;
		const isPartial = !!installed && !isComplete;
		const details = [languageDisplayName(descriptor.language), descriptor.source ? SOURCE_LABELS[descriptor.source] : TIER_LABELS[descriptor.tier]];
		const missing = resourceMissingAyahs(installed?.meta);
		if (missing) details.push(t().libraryCoverageMissing(missing));
		if (isUpdate) details.push(t().libraryResourceUpdateStatus);
		else if (isPartial) details.push(t().libraryResourcePartialStatus(installed.installedSurahs?.length ?? 0, 114));
		else if (isComplete) details.push(t().libraryInstalledTooltip);
		const setting = new Setting(listEl)
			.setName(descriptor.name)
			.setDesc(details.join(" · "));

		if (installed && ((isComplete && !isUpdate) || !descriptor.source)) {
			setting.addExtraButton((button) => button
				.setIcon("checkmark")
				.setTooltip(t().libraryInstalledTooltip)
				.setDisabled(true));
			setting.addButton((button) => button
				.setButtonText(t().libraryRemoveButton)
				.onClick(() => void this.removeResource(descriptor)));
			return;
		}

		setting.addButton((button) => {
			button.setButtonText(
				isUpdate ? t().libraryUpdateButton : isPartial ? t().libraryResumeButton : t().libraryInstallButton,
			);
			if (this.busy) button.setDisabled(true);
			button.onClick(async () => {
				if (this.busy) {
					logMessage(t().noticeDownloadOrImportInProgress, "warn");
					return;
				}
				const source = descriptor.source ? this.plugin.downloadSources[descriptor.source] : undefined;
				if (!source) return;
				const controller = new AbortController();
				this.activeDownload = controller;
				this.busy = true;
				button.setDisabled(true);
					progressEl.empty();
					progressEl.setAttr("role", "status");
					const text = progressEl.createSpan({ text: t().libraryDownloadStarting(descriptor.name) });
					const meter = progressEl.createEl("progress", { cls: "falah-download-meter" });
					meter.max = 114;
					meter.value = installed?.installedSurahs?.length ?? 0;
				const cancelButton = progressEl.createEl("button", {
					text: t().libraryCancelButton,
					cls: "falah-cancel",
				});
				cancelButton.addEventListener("click", () => controller.abort());
				try {
					await downloadResource(
						descriptor,
						source,
						{
							fetchJson: this.plugin.fetchJson,
							store: this.plugin.store,
							registry: this.plugin.registry,
						},
						(progress) => {
							meter.max = progress.surahsTotal;
							meter.value = progress.surahsDone;
							text.setText(t().libraryDownloadProgress(
								descriptor.name,
								progress.surahsDone,
								progress.surahsTotal,
							));
						},
						controller.signal,
						{ replaceExisting: isUpdate },
					);
					const cancelled = controller.signal.aborted;
					this.busy = false;
					this.activeDownload = undefined;
					logMessage(cancelled ? t().noticeDownloadCancelled : t().noticeInstalled(descriptor.name), "info");
					if (!cancelled) this.plugin.refreshReader();
					await this.rerender();
				} catch (error) {
					this.busy = false;
					this.activeDownload = undefined;
					progressEl.empty();
					button.setDisabled(false);
					logMessage(t().noticeDownloadFailed(errMsg(error)), "error");
				}
			});
		});
	}
}

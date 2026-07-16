// Plugin shell: settings, providers, cache, commands, and registration of the
// slash suggest, Live Preview decorations, and Reading mode post-processor.

import { Editor, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import {
	IslamicReference,
	RenderedText,
	findReferences,
	parseRefUri,
	toCallout,
	toLabel,
	toMarkdownLink,
	toUri,
} from "./ref";
import { AlQuranCloudProvider, HadithCdnProvider, errMsg } from "./providers";
import { HadithCollectionPickerModal, HonorificModal, QuranSearchModal, SlashSuggest } from "./suggest";
import { livePreviewChips } from "./decorations";
import { falahPostProcessor } from "./postprocess";
import { ReferenceDetailModal } from "./detail";
import type { ArabicScript, ReferenceContent, HadithContent, VerseContent } from "./data/schema";
import type { ResourceDescriptor } from "./data/schema";
import { DataStore } from "./data/store";
import type { FileIO } from "./data/store";
import { categoryForType } from "./data/store";
import { Registry } from "./data/registry";
import { CoreLoader, CORE_CLEARQURAN_ID, defaultCoreImportMap } from "./data/core";
import { AlQuranCloudSource, Fawazahmed0Source, QulSource, downloadResource } from "./data/download";
import type { DownloadSource, FetchJson } from "./data/download";
import { scanImportsFolder } from "./data/imports";
import { SOURCE_LABELS, TIER_LABELS, distinctLanguages, filterCatalog, languageDisplayName } from "./settings-helpers";
import { CacheEntry, LiveApiSource, QuranDataSource, RefCache, SourceChain } from "./data/source";
import type { DownloadSourceId } from "./data/schema";
import { makeFetchJson, makeFileIO } from "./data/obsidian-io";
import { ResourceStore } from "./data/content/resource-store";
import { InstallIndex } from "./data/content/install-index";
import { CatalogCache } from "./data/content/catalog-cache";
import { HadithCoreLoader } from "./data/hadith/core";
import { HadithResolver } from "./data/hadith/source";
import {
	Fawazahmed0HadithSource,
	AhmedBasetHadithSource,
	SunnahComHadithSource,
	OpenHadithCsvSource,
	type HadithSource,
} from "./data/hadith/sources";
import type { HadithCatalogEntry } from "./data/hadith/schema";
import { QuranReaderView, VIEW_TYPE_QURAN_READER } from "./reader";
import { defaultVerseActions } from "./verse-actions";
import type { VerseAction } from "./verse-actions";
import { DEFAULT_FONT_BY_SCRIPT, bundledFontsForScript, dedupeFamilies, fontStackFor } from "./fonts";
import { FontManager, enumerateSystemFonts } from "./font-loader";
import {
	VerseActionRegistry,
	FALAH_REF,
	FALAH_API_VERSION,
	type FalahApi,
	type AyahRowDecorator,
	type VerseText,
} from "./api";

interface FalahSettings {
	translationEdition: string;
	tafsirEdition: string;
	arabicScript: ArabicScript;
	translationResourceId: string;
	tafsirResourceId: string;
	fontByScript: Record<string, string>;
	hadithSunnahApiKey: string;
}

const DEFAULT_SETTINGS: FalahSettings = {
	translationEdition: "en.sahih",
	tafsirEdition: "",
	arabicScript: "uthmani",
	translationResourceId: CORE_CLEARQURAN_ID,
	tafsirResourceId: "",
	fontByScript: { ...DEFAULT_FONT_BY_SCRIPT },
	hadithSunnahApiKey: "",
};

export default class FalahPlugin extends Plugin {
	settings: FalahSettings = { ...DEFAULT_SETTINGS };
	cache!: RefCache;
	io!: FileIO; // plugin-dir-scoped; also used directly by the imports/ scan (Task 10)
	store!: DataStore;
	registry!: Registry;
	downloadSources!: Record<DownloadSourceId, DownloadSource>;
	fetchJson!: FetchJson;
	liveApi!: LiveApiSource;
	quranData!: QuranDataSource;
	sourceChain!: SourceChain;
	hadith!: HadithResolver;
	hadithSources!: HadithSource[];
	hadithFetchText!: FetchJson;
	hadithCatalog!: CatalogCache<HadithCatalogEntry>;
	/** Per-verse menu actions; seeded with the defaults, appendable by future
	 *  subsystems (audio, journaling) without touching the reader. */
	private verseActionRegistry = new VerseActionRegistry(defaultVerseActions());
	ayahRowDecorators: AyahRowDecorator[] = [];
	api!: FalahApi;
	fonts!: FontManager;

	registerVerseAction(action: VerseAction): () => void {
		return this.verseActionRegistry.register(action);
	}
	verseActionList(): VerseAction[] {
		return this.verseActionRegistry.list();
	}
	registerAyahRowDecorator(decorator: AyahRowDecorator): () => void {
		this.ayahRowDecorators.push(decorator);
		return () => {
			const i = this.ayahRowDecorators.indexOf(decorator);
			if (i >= 0) this.ayahRowDecorators.splice(i, 1);
		};
	}
	async getVerseText(surah: number, ayah: number): Promise<VerseText | undefined> {
		try {
			const reading = await this.quranData.getSurahReading(surah, {
				script: this.settings.arabicScript,
				translationId: this.settings.translationResourceId || undefined,
			});
			const a = reading.ayahs.find((x) => x.ayah === ayah);
			return a ? { arabic: a.arabic, translation: a.translation } : undefined;
		} catch {
			return undefined;
		}
	}
	navigateReaderTo(surah: number, ayah: number): void {
		void this.openReader().then(() => {
			const leaf = this.findReaderLeaf();
			const view = leaf?.view;
			if (view instanceof QuranReaderView) view.navigateTo(surah, ayah);
		});
	}

	async onload(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as {
			settings?: Partial<FalahSettings>;
			cache?: Record<string, CacheEntry>;
		};
		this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
		// A saved fontByScript replaces the default map wholesale, so re-merge the
		// per-script defaults underneath to back-fill any missing script.
		this.settings.fontByScript = { ...DEFAULT_FONT_BY_SCRIPT, ...(data.settings?.fontByScript ?? {}) };
		this.cache = new RefCache(data.cache ?? {}, () => void this.persist());

		this.fonts = new FontManager(this.app, `${this.manifest.dir ?? ""}/fonts`);
		void this.fonts.reload();
		this.registerEvent(
			this.app.workspace.on("window-open", (_win, w) => this.fonts.injectInto(w.document))
		);

		this.io = makeFileIO(this.app.vault.adapter, this.manifest.dir ?? "");
		this.store = new DataStore(this.io);
		this.registry = new Registry(this.io, this.store, new CoreLoader(defaultCoreImportMap));
		this.fetchJson = makeFetchJson(requestUrl);
		this.downloadSources = {
			fawazahmed0: new Fawazahmed0Source(this.fetchJson),
			"alquran-cloud": new AlQuranCloudSource(this.fetchJson),
			qul: new QulSource(this.fetchJson),
		};

		const quranProvider = new AlQuranCloudProvider(() => ({
			translation: this.settings.translationEdition,
			tafsir: this.settings.tafsirEdition,
		}));
		const hadithProvider = new HadithCdnProvider();
		this.liveApi = new LiveApiSource(quranProvider, hadithProvider, this.cache, () => ({
			translation: this.settings.translationEdition,
			tafsir: this.settings.tafsirEdition,
		}));
		this.quranData = new QuranDataSource(this.store, this.registry);
		this.sourceChain = new SourceChain([this.quranData, this.liveApi]);
		void this.store.cleanupOrphanedTmp();

		// Hadith offline layer (generic content infra + isolated hadith domain).
		const hadithStore = new ResourceStore(this.io);
		const hadithIndex = new InstallIndex(this.io, "hdata/index.json");
		this.hadithFetchText = (url) =>
			requestUrl({ url, throw: false }).then((r) => {
				if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
				return r.text as unknown;
			});
		this.hadith = new HadithResolver(hadithStore, hadithIndex, new HadithCoreLoader(), {
			getHadith: (ref) => hadithProvider.getHadith(ref),
		});
		this.hadithSources = [
			new Fawazahmed0HadithSource(),
			new AhmedBasetHadithSource(),
			new SunnahComHadithSource(() => this.settings.hadithSunnahApiKey ?? ""),
			new OpenHadithCsvSource(),
		];
		this.hadithCatalog = new CatalogCache<HadithCatalogEntry>(this.io, (key) => `hdata/catalog-${key}.json`);

		this.registerEditorSuggest(new SlashSuggest(this));
		this.registerEditorExtension(livePreviewChips(this));
		this.registerMarkdownPostProcessor(falahPostProcessor(this));
		this.addSettingTab(new FalahSettingTab(this));

		this.registerView(VIEW_TYPE_QURAN_READER, (leaf) => new QuranReaderView(leaf, this));
		this.api = {
			version: FALAH_API_VERSION,
			registerVerseAction: (a) => this.registerVerseAction(a),
			registerAyahRowDecorator: (d) => this.registerAyahRowDecorator(d),
			getVerseText: (s, a) => this.getVerseText(s, a),
			navigateReaderTo: (s, a) => this.navigateReaderTo(s, a),
			refreshReader: () => this.refreshReaderRows(),
			ref: FALAH_REF,
		};
		this.addRibbonIcon("book-open", "Open Quran reader", () => void this.openReader());
		this.addCommand({
			id: "open-quran-reader",
			name: "Open Quran reader",
			callback: () => void this.openReader(),
		});
		this.addCommand({
			id: "pop-out-quran-reader",
			name: "Pop out Quran reader",
			callback: () => {
				const leaf = this.findReaderLeaf();
				if (leaf) this.app.workspace.moveLeafToPopout(leaf);
				else new Notice("Open the Quran reader first");
			},
		});

		this.addCommand({
			id: "insert-quran",
			name: "Insert Quran verse",
			editorCallback: (editor) => new QuranSearchModal(this, editor).open(),
		});
		this.addCommand({
			id: "insert-hadith",
			name: "Insert hadith reference",
			editorCallback: (editor) => new HadithCollectionPickerModal(this, editor).open(),
		});
		this.addCommand({
			id: "insert-honorific",
			name: "Insert honorific",
			editorCallback: (editor) => new HonorificModal(this, editor).open(),
		});
		this.addCommand({
			id: "open-detail",
			name: "Open Islamic reference detail",
			editorCheckCallback: (checking, editor) => {
				const ref = this.refUnderCursor(editor);
				if (!ref) return false;
				if (!checking) this.openDetail(ref);
				return true;
			},
		});
		this.addCommand({
			id: "copy-reference-text",
			name: "Copy reference as text",
			editorCheckCallback: (checking, editor) => {
				const ref = this.refUnderCursor(editor);
				if (!ref) return false;
				if (!checking) void this.copyReferenceText(ref);
				return true;
			},
		});
		this.addCommand({
			id: "refresh-reference",
			name: "Refresh Islamic reference under cursor",
			editorCallback: (editor) => void this.refreshAtCursor(editor),
		});
	}

	async persist(): Promise<void> {
		await this.saveData({ settings: this.settings, cache: this.cache.data });
	}

	openDetail(ref: IslamicReference): void {
		new ReferenceDetailModal(this, ref).open();
	}

	/** CSS font-family stack for the Quran Arabic of a given script. */
	arabicFontStack(script: string): string {
		return fontStackFor(this.settings.fontByScript[script] || DEFAULT_FONT_BY_SCRIPT[script] || "");
	}

	openDetailFromUri(uri: string): void {
		const ref = parseRefUri(uri);
		if (ref) this.openDetail(ref);
		else new Notice("Unsupported Falah reference: " + uri);
	}

	/** Open (or focus) the single Quran Reader at a surah/ayah, navigating an
	 *  existing one in place. The reader leaf is found by scanning ALL leaves and
	 *  matching the persisted view-state type — not `getLeavesOfType` + `instanceof
	 *  QuranReaderView`, because a backgrounded leaf is *deferred* (Obsidian 1.7.2+):
	 *  its `.view` is a `DeferredView`, not our class, and it can be missed by the
	 *  typed lookup, which made every open spawn a new tab. `getViewState().type`
	 *  is set on deferred leaves and works across popout windows too. */
	/** Find the single reader leaf across all windows, matching deferred leaves too. */
	private findReaderLeaf(): WorkspaceLeaf | undefined {
		let leaf: WorkspaceLeaf | undefined;
		this.app.workspace.iterateAllLeaves((l) => {
			if (!leaf && l.getViewState().type === VIEW_TYPE_QURAN_READER) leaf = l;
		});
		return leaf;
	}

	/** Refresh an open reader's resource dropdowns after the installed set changes
	 *  (download/import/remove), so a new translation/tafsir shows up without the
	 *  user having to close and reopen the reader. No-op if no reader is open or it
	 *  hasn't loaded yet (a deferred reader re-reads the list when it opens). */
	refreshReader(): void {
		const leaf = this.findReaderLeaf();
		if (leaf && leaf.view instanceof QuranReaderView) void leaf.view.refresh();
	}

	/** Re-render the open reader's ayah rows (re-runs row decorators), e.g. after a
	 *  companion plugin's own index changes. No-op if no reader is open or it hasn't
	 *  loaded yet. Distinct from refreshReader() above (toolbar/dropdown refresh) —
	 *  this only touches row content, not the toolbar. Backs FalahApi.refreshReader. */
	refreshReaderRows(): void {
		const leaf = this.findReaderLeaf();
		if (leaf && leaf.view instanceof QuranReaderView) leaf.view.refreshRows();
	}

	async openReader(surah = 1, ayah?: number): Promise<void> {
		const { workspace } = this.app;
		let leaf = this.findReaderLeaf();
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_QURAN_READER, active: true });
		}
		await workspace.revealLeaf(leaf);
		// revealLeaf loads a deferred leaf, but await the explicit load before we
		// reach into the view instance to navigate it.
		await (leaf as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
		if (leaf.view instanceof QuranReaderView) leaf.view.navigateTo(surah, ayah);
	}

	async getDetail(ref: IslamicReference): Promise<ReferenceContent> {
		if (ref.kind === "hadith") return this.hadith.getHadith(ref);
		return this.sourceChain.getContent(ref, {
			script: this.settings.arabicScript,
			translationId: this.settings.translationResourceId || undefined,
			tafsirId: this.settings.tafsirResourceId || undefined,
		});
	}

	renderedText(content: ReferenceContent): RenderedText {
		if (content.ref.kind === "quran") {
			const d = content as VerseContent;
			return {
				arabic: d.arabic,
				translation: d.translation,
				attribution: d.surahNameEnglish ? `Surah ${d.surahNameEnglish}` : undefined,
			};
		}
		const d = content as HadithContent;
		return {
			arabic: d.arabic,
			translation: d.translation,
			attribution: [d.bookName, d.grades].filter(Boolean).join(" · ") || undefined,
		};
	}

	/** Insert at cursor: reference-only inline, callout with fetched text on an empty line. */
	async insertReference(editor: Editor, ref: IslamicReference): Promise<void> {
		const cursor = editor.getCursor();
		if (editor.getLine(cursor.line).trim() !== "") {
			const link = toMarkdownLink(ref);
			editor.replaceRange(link, cursor);
			editor.setCursor({ line: cursor.line, ch: cursor.ch + link.length });
			return;
		}
		let text: RenderedText | undefined;
		try {
			text = this.renderedText(await this.getDetail(ref));
		} catch (e) {
			new Notice(`Inserted reference without text: ${errMsg(e)}`);
		}
		editor.replaceRange(toCallout(ref, text) + "\n", cursor);
	}

	refUnderCursor(editor: Editor): IslamicReference | null {
		const cursor = editor.getCursor();
		const refs = findReferences(editor.getLine(cursor.line));
		if (!refs.length) return null;
		const hit = refs.find((r) => cursor.ch >= r.index && cursor.ch <= r.index + r.match.length);
		return (hit ?? refs[0]).ref;
	}

	private async copyReferenceText(ref: IslamicReference): Promise<void> {
		try {
			const t = this.renderedText(await this.getDetail(ref));
			const parts = [toLabel(ref), t.arabic, t.translation].filter(Boolean) as string[];
			await navigator.clipboard.writeText(parts.join("\n\n"));
			new Notice("Reference text copied");
		} catch (e) {
			new Notice(errMsg(e));
		}
	}

	/** Refresh cached content; if the cursor is in a reference callout, rewrite its body too. */
	private async refreshAtCursor(editor: Editor): Promise<void> {
		const cur = editor.getCursor();
		const isQuote = (n: number) =>
			n >= 0 && n < editor.lineCount() && editor.getLine(n).startsWith(">");

		if (isQuote(cur.line)) {
			let start = cur.line;
			let end = cur.line;
			while (isQuote(start - 1)) start--;
			while (isQuote(end + 1)) end++;
			const lines: string[] = [];
			for (let n = start; n <= end; n++) lines.push(editor.getLine(n));
			const refs = findReferences(lines.join("\n"));
			if (refs.length) {
				const ref = refs[0].ref;
				this.cache.deletePrefix(toUri(ref) + "|");
				try {
					const text = this.renderedText(await this.getDetail(ref));
					editor.replaceRange(
						toCallout(ref, text),
						{ line: start, ch: 0 },
						{ line: end, ch: editor.getLine(end).length }
					);
					new Notice(`${toLabel(ref)} refreshed`);
				} catch (e) {
					new Notice(errMsg(e));
				}
				return;
			}
		}

		const ref = this.refUnderCursor(editor);
		if (!ref) {
			new Notice("No Islamic reference under cursor");
			return;
		}
		this.cache.deletePrefix(toUri(ref) + "|");
		try {
			await this.getDetail(ref);
			new Notice(`${toLabel(ref)} cache refreshed`);
		} catch (e) {
			new Notice(errMsg(e));
		}
	}
}

class FalahSettingTab extends PluginSettingTab {
	constructor(private plugin: FalahPlugin) {
		super(plugin.app, plugin);
	}

	/** One-at-a-time guard for every button that does an unlocked read-modify-write
	 *  on index.json (download, remove, import). Registry.recordSurahInstalled /
	 *  recordImport are only safe run sequentially (documented in download.ts), so a
	 *  double-click racing two writers would lose install records. */
	private busy = false;
	/** The in-flight download's controller so the Cancel button can reach it. */
	private activeDownload?: AbortController;

	/** Resource-browser state, persisted across re-renders within a session. */
	private browse: {
		source: DownloadSourceId;
		type: "translation" | "tafsir";
		catalog: ResourceDescriptor[];
		updateIds: Set<string>;
		search: string;
		language: string; // "" = all
		loading: boolean;
		fetched: boolean;
	} = {
		source: "fawazahmed0",
		type: "translation",
		catalog: [],
		updateIds: new Set(),
		search: "",
		language: "",
		loading: false,
		fetched: false,
	};

	display(): void {
		void this.render();
	}

	private async render(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		let resources: ResourceDescriptor[];
		try {
			resources = await this.plugin.quranData.listResources();
		} catch (e) {
			// listResources() is withStorageBoundary-wrapped and can throw a typed
			// DataError. render() runs detached (`void this.render()`), so degrade to
			// an error state rather than leaking an unhandled rejection.
			new Notice(errMsg(e));
			containerEl.createEl("p", {
				text: `Couldn't load installed resources: ${errMsg(e)}`,
				cls: "falah-settings-error",
			});
			return;
		}

		this.renderDisplayZone(containerEl, resources);
		this.renderLibraryZone(containerEl, resources);
		this.renderAdvancedZone(containerEl);
	}

	private renderDisplayZone(containerEl: HTMLElement, resources: ResourceDescriptor[]): void {
		containerEl.createEl("h3", { text: "Display" });

		new Setting(containerEl)
			.setName("Arabic script")
			.setDesc("Which script renders Quran text (both ship by default).")
			.addDropdown((d) =>
				d
					.addOption("uthmani", "Uthmani")
					.addOption("indopak", "Indo-Pak")
					.setValue(this.plugin.settings.arabicScript)
					.onChange(async (v) => {
						this.plugin.settings.arabicScript = v;
						await this.plugin.persist();
					})
			);

		const label = (r: ResourceDescriptor) => (r.tier === "bundled" ? `${r.name} (default)` : r.name);

		new Setting(containerEl)
			.setName("Preferred translation")
			.setDesc("Shown alongside the Arabic text.")
			.addDropdown((d) => {
				d.addOption("", "None");
				for (const r of resources.filter((x) => x.type === "translation")) d.addOption(r.id, label(r));
				d.setValue(this.plugin.settings.translationResourceId).onChange(async (v) => {
					this.plugin.settings.translationResourceId = v;
					await this.plugin.persist();
				});
			});

		new Setting(containerEl)
			.setName("Preferred tafsir")
			.setDesc("Shown alongside the Arabic text (none ship by default).")
			.addDropdown((d) => {
				d.addOption("", "None");
				for (const r of resources.filter((x) => x.type === "tafsir")) d.addOption(r.id, label(r));
				d.setValue(this.plugin.settings.tafsirResourceId).onChange(async (v) => {
					this.plugin.settings.tafsirResourceId = v;
					await this.plugin.persist();
				});
			});
		// --- Fonts (per script) ---
		const scripts: { id: ArabicScript; label: string }[] = [
			{ id: "uthmani", label: "Uthmani font" },
			{ id: "indopak", label: "Indo-Pak font" },
		];
		// Extra families offered beyond the bundled set: vault fonts + any system
		// font already chosen (so the current value stays selectable) + detected.
		const detected: string[] = [];
		const fontOptions = (script: ArabicScript): string[] =>
			dedupeFamilies(
				[
					...bundledFontsForScript(script).map((f) => f.family),
					...this.plugin.fonts.vaultFamilies(),
					...detected,
					this.plugin.settings.fontByScript[script],
				].filter(Boolean)
			);

		for (const s of scripts) {
			new Setting(containerEl)
				.setName(s.label)
				.setDesc("Applied to this script's Arabic in the reader and detail view.")
				.addDropdown((d) => {
					for (const fam of fontOptions(s.id)) d.addOption(fam, fam);
					d.setValue(this.plugin.settings.fontByScript[s.id]).onChange(async (v) => {
						this.plugin.settings.fontByScript[s.id] = v;
						await this.plugin.persist();
						this.plugin.refreshReader();
					});
				})
				.addText((t) =>
					t.setPlaceholder("or type a system font…").onChange(async (v) => {
						const fam = v.trim();
						if (!fam) return;
						this.plugin.settings.fontByScript[s.id] = fam;
						await this.plugin.persist();
						this.plugin.refreshReader();
					})
				);
		}

		new Setting(containerEl)
			.setName("Font sources")
			.setDesc(
				`Detect installed fonts (desktop), or drop .ttf/.woff2 files into ${this.plugin.manifest.dir ?? ""}/fonts and reload.`
			)
			.addButton((b) =>
				b.setButtonText("Detect installed fonts").onClick(async () => {
					try {
						const fams = await enumerateSystemFonts();
						if (!fams.length) {
							new Notice("Font detection unavailable here — type the font name instead.");
							return;
						}
						detected.push(...fams);
						new Notice(`Detected ${fams.length} fonts.`);
						await this.render();
					} catch {
						new Notice("Couldn't access system fonts (permission denied or unsupported).");
					}
				})
			)
			.addButton((b) =>
				b.setButtonText("Reload vault fonts").onClick(async () => {
					await this.plugin.fonts.reload();
					new Notice("Reloaded fonts.");
					this.plugin.refreshReader();
					await this.render();
				})
			);
	}

	private renderLibraryZone(containerEl: HTMLElement, resources: ResourceDescriptor[]): void {
		containerEl.createEl("h3", { text: "Library" });
		const installedIds = new Set(resources.map((r) => r.id));

		// --- Browse & install ---
		containerEl.createEl("h4", { text: "Browse & install" });

		const bar = containerEl.createDiv({ cls: "falah-filter-bar" });
		const searchInput = bar.createEl("input", { type: "search", cls: "falah-search" });
		searchInput.placeholder = "Search…";
		searchInput.value = this.browse.search;
		const langSelect = bar.createEl("select", { cls: "dropdown falah-lang-select" });
		const typeSelect = bar.createEl("select", { cls: "dropdown" });
		typeSelect.createEl("option", { value: "translation", text: "Translation" });
		typeSelect.createEl("option", { value: "tafsir", text: "Tafsir" });
		typeSelect.value = this.browse.type;
		const sourceSelect = bar.createEl("select", { cls: "dropdown" });
		for (const id of ["fawazahmed0", "alquran-cloud", "qul"] as DownloadSourceId[]) {
			sourceSelect.createEl("option", { value: id, text: SOURCE_LABELS[id] });
		}
		sourceSelect.value = this.browse.source;
		const refreshBtn = bar.createEl("button", { text: "Refresh", cls: "falah-refresh" });

		const listEl = containerEl.createDiv({ cls: "falah-resource-list" });
		const progressEl = containerEl.createDiv({ cls: "falah-download-progress" });

		const rebuildLangOptions = () => {
			langSelect.empty();
			langSelect.createEl("option", { value: "", text: "All languages" });
			for (const { value, name } of distinctLanguages(this.browse.catalog)) {
				langSelect.createEl("option", { value, text: name });
			}
			langSelect.value = this.browse.language;
		};

		const renderList = () => {
			listEl.empty();
			if (this.browse.loading) {
				listEl.createEl("p", { text: "Loading…", cls: "falah-muted" });
				return;
			}
			if (!this.browse.fetched) {
				listEl.createEl("p", { text: "Pick a source to browse resources.", cls: "falah-muted" });
				return;
			}
			const filtered = filterCatalog(this.browse.catalog, {
				search: this.browse.search,
				language: this.browse.language,
			});
			if (!filtered.length) {
				listEl.createEl("p", { text: "No resources match your filters.", cls: "falah-muted" });
				return;
			}
			for (const desc of filtered) {
				this.renderResourceRow(listEl, desc, installedIds.has(desc.id), progressEl);
			}
		};

		const fetchCatalog = async (force: boolean) => {
			this.browse.loading = true;
			this.browse.fetched = true;
			renderList();
			try {
				const source = this.plugin.downloadSources[this.browse.source];
				const { resources: catalog } = await this.plugin.registry.getCatalog(
					this.browse.source,
					this.browse.type,
					() => source.listCatalog(this.browse.type),
					{ force }
				);
				this.browse.catalog = catalog;
				this.browse.updateIds = new Set(await this.plugin.registry.updatesAvailable(catalog));
			} catch (e) {
				this.browse.catalog = [];
				new Notice(errMsg(e));
			} finally {
				this.browse.loading = false;
				rebuildLangOptions();
				renderList();
			}
		};

		searchInput.addEventListener("input", () => {
			this.browse.search = searchInput.value;
			renderList();
		});
		langSelect.addEventListener("change", () => {
			this.browse.language = langSelect.value;
			renderList();
		});
		typeSelect.addEventListener("change", () => {
			this.browse.type = typeSelect.value as "translation" | "tafsir";
			this.browse.language = "";
			void fetchCatalog(false);
		});
		sourceSelect.addEventListener("change", () => {
			this.browse.source = sourceSelect.value as DownloadSourceId;
			this.browse.language = "";
			void fetchCatalog(false);
		});
		refreshBtn.addEventListener("click", () => void fetchCatalog(true));

		rebuildLangOptions();
		if (this.browse.fetched) renderList();
		else void fetchCatalog(false);

		// --- Installed resources ---
		containerEl.createEl("h4", { text: "Installed resources" });
		const installed = resources.filter((x) => x.tier !== "bundled");
		if (!installed.length) containerEl.createEl("p", { text: "Nothing installed yet.", cls: "falah-muted" });
		for (const r of installed) {
			new Setting(containerEl)
				.setName(r.name)
				.setDesc(`${r.type} · ${TIER_LABELS[r.tier]}${r.source ? ` · ${SOURCE_LABELS[r.source]}` : ""}`)
				.addButton((b) =>
					b
						.setButtonText("Remove")
						.setWarning()
						.onClick(() => void this.removeResource(r))
				);
		}

		// --- Manual import ---
		containerEl.createEl("h4", { text: "Manual import" });
		new Setting(containerEl)
			.setName("Scan imports folder")
			.setDesc("Reads JSON packs dropped into the plugin's imports/ folder.")
			.addButton((b) =>
				b.setButtonText("Scan").onClick(async () => {
					if (this.busy) {
						new Notice("A download or import is already in progress");
						return;
					}
					this.busy = true;
					b.setDisabled(true);
					try {
						const result = await scanImportsFolder({
							io: this.plugin.io,
							store: this.plugin.store,
							registry: this.plugin.registry,
						});
						new Notice(
							`Imported ${result.ok.length} resource(s)` +
								(result.failed.length ? `; failed: ${result.failed.join(", ")}` : "")
						);
						this.plugin.refreshReader();
						await this.render();
					} catch (e) {
						new Notice(errMsg(e));
					} finally {
						this.busy = false;
						b.setDisabled(false);
					}
				})
			);

		this.renderHadithLibrary(containerEl);
	}

	private renderHadithLibrary(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Hadith collections" });
		const hadithBox = containerEl.createDiv({ cls: "falah-hadith-library" });

		const sourceSel = hadithBox.createEl("select", { cls: "dropdown" });
		for (const s of this.plugin.hadithSources) {
			sourceSel.createEl("option", { value: s.id, text: s.id });
		}

		// sunnah.com API key field (shown only when that source is selected)
		const keyRow = hadithBox.createDiv({ cls: "falah-hadith-keyrow" });
		const keyInput = keyRow.createEl("input", { type: "text", attr: { placeholder: "sunnah.com API key" } });
		keyInput.value = this.plugin.settings.hadithSunnahApiKey ?? "";
		keyInput.onchange = async () => {
			this.plugin.settings.hadithSunnahApiKey = keyInput.value.trim();
			await this.plugin.persist();
		};

		const listEl = hadithBox.createDiv({ cls: "falah-hadith-list" });
		const status = hadithBox.createDiv({ cls: "falah-hadith-status falah-muted" });

		const source = () => this.plugin.hadithSources.find((s) => s.id === sourceSel.value)!;
		const isCsv = () => source().id === "mhashim6";
		const updateKeyVisibility = () => {
			keyRow.style.display = source().needsApiKey ? "" : "none";
		};

		const renderCatalog = async (force = false) => {
			updateKeyVisibility();
			listEl.empty();
			status.setText("Loading catalog…");
			let entries: HadithCatalogEntry[] = [];
			try {
				const res = await this.plugin.hadithCatalog.get(
					source().id,
					() => source().listCatalog(this.plugin.fetchJson),
					{ force }
				);
				entries = res.resources;
				status.setText(res.stale ? "Showing cached catalog (offline)" : "");
			} catch (e) {
				status.setText(errMsg(e));
			}
			const installed = new Set((await this.plugin.hadith.listInstalled()).map((d) => d.id));
			for (const entry of entries) {
				const row = listEl.createDiv({ cls: "falah-hadith-row" });
				row.createSpan({ text: entry.name });
				const langSel = row.createEl("select", { cls: "dropdown" });
				for (const l of entry.languages) langSel.createEl("option", { value: l, text: l });
				const btn = row.createEl("button");
				const idFor = () => `${entry.source}-${entry.collection}-${langSel.value}`;
				const sync = () => {
					btn.setText(installed.has(idFor()) ? "Remove" : "Install");
				};
				langSel.onchange = sync;
				sync();
				btn.onclick = async () => {
					const id = idFor();
					btn.disabled = true;
					try {
						if (installed.has(id)) {
							await this.plugin.hadith.remove(id);
							installed.delete(id);
						} else {
							btn.setText("Downloading…");
							const transport = isCsv() ? this.plugin.hadithFetchText : this.plugin.fetchJson;
							const collection = await source().fetchCollection(entry.collection, langSel.value, transport);
							await this.plugin.hadith.install(
								{
									id,
									source: entry.source,
									collection: entry.collection,
									language: langSel.value,
									name: entry.name,
									count: collection.hadiths.length,
								},
								collection
							);
							installed.add(id);
						}
					} catch (e) {
						status.setText(errMsg(e));
					} finally {
						btn.disabled = false;
						sync();
						void renderInstalled(); // keep the source-independent installed list in sync
					}
				};
			}
		};

		sourceSel.onchange = () => void renderCatalog();
		void renderCatalog();

		// ---- Installed hadith collections (source-independent view) ----
		const installedWrap = hadithBox.createDiv({ cls: "falah-hadith-installed" });
		const renderInstalled = async () => {
			installedWrap.empty();
			installedWrap.createEl("h4", { text: "Installed hadith collections" });
			const descs = await this.plugin.hadith.listInstalled();
			if (!descs.length) {
				installedWrap.createEl("p", { text: "Nothing installed yet.", cls: "falah-muted" });
				return;
			}
			for (const d of descs) {
				const row = installedWrap.createDiv({ cls: "falah-hadith-row" });
				row.createSpan({ text: `${d.name} · ${d.count ?? 0} hadith · ${d.source}` });
				const rm = row.createEl("button", { text: "Remove" });
				rm.onclick = async () => {
					rm.disabled = true;
					try {
						await this.plugin.hadith.remove(d.id);
					} catch (e) {
						new Notice(errMsg(e));
					}
					await this.render();
				};
			}
		};
		void renderInstalled();
	}

	private async removeResource(r: ResourceDescriptor): Promise<void> {
		if (this.busy) {
			new Notice("Another resource operation is in progress");
			return;
		}
		this.busy = true;
		try {
			await this.plugin.registry.removeResource(r.id, categoryForType(r.type));
			new Notice(`Removed ${r.name}`);
			this.plugin.refreshReader();
			await this.render();
		} catch (e) {
			new Notice(errMsg(e));
		} finally {
			this.busy = false;
		}
	}

	private renderResourceRow(
		listEl: HTMLElement,
		desc: ResourceDescriptor,
		installed: boolean,
		progressEl: HTMLElement
	): void {
		const isUpdate = this.browse.updateIds.has(desc.id);
		const setting = new Setting(listEl)
			.setName(desc.name)
			.setDesc(
				`${languageDisplayName(desc.language)} · ${SOURCE_LABELS[this.browse.source]}` +
					(isUpdate ? " · update available" : "")
			);

		if (installed && !isUpdate) {
			setting.addExtraButton((b) => b.setIcon("checkmark").setTooltip("Installed").setDisabled(true));
			setting.addButton((b) =>
				b
					.setButtonText("Remove")
					.setWarning()
					.onClick(() => void this.removeResource(desc))
			);
			return;
		}

		setting.addButton((b) => {
			b.setButtonText(isUpdate ? "Update" : "Install");
			if (this.busy) b.setDisabled(true);
			b.onClick(async () => {
				if (this.busy) {
					new Notice("A download or import is already in progress");
					return;
				}
				const source = this.plugin.downloadSources[this.browse.source];
				const controller = new AbortController();
				this.activeDownload = controller;
				this.busy = true;
				b.setDisabled(true);
				progressEl.empty();
				const txt = progressEl.createSpan({ text: `${desc.name}: starting…` });
				const cancelBtn = progressEl.createEl("button", { text: "Cancel", cls: "falah-cancel" });
				cancelBtn.addEventListener("click", () => controller.abort());
				try {
					// Update-in-place: downloadResource skips surahs already recorded, so
					// wipe the old install first (index entry + files) to force a re-fetch.
					if (isUpdate) {
						await this.plugin.registry.removeResource(desc.id, categoryForType(desc.type));
					}
					await downloadResource(
						desc,
						source,
						{
							fetchJson: this.plugin.fetchJson,
							store: this.plugin.store,
							registry: this.plugin.registry,
						},
						(p) => txt.setText(`${desc.name}: ${p.surahsDone}/${p.surahsTotal} surahs`),
						controller.signal
					);
					// downloadResource returns early (not throws) on abort — detect here.
					const cancelled = controller.signal.aborted;
					// Reset state BEFORE render() rebuilds the list/buttons (rows read
					// `this.busy` at construction time).
					this.busy = false;
					this.activeDownload = undefined;
					new Notice(cancelled ? "Download cancelled" : `${desc.name} installed`);
					if (!cancelled) this.plugin.refreshReader();
					await this.render();
				} catch (e) {
					this.busy = false;
					this.activeDownload = undefined;
					progressEl.empty();
					b.setDisabled(false);
					new Notice(`Download failed: ${errMsg(e)}`);
				}
			});
		});
	}

	private renderAdvancedZone(containerEl: HTMLElement): void {
		const details = containerEl.createEl("details", { cls: "falah-advanced" });
		details.createEl("summary", { text: "Advanced" });

		new Setting(details)
			.setName("Online fallback translation edition")
			.setDesc(
				"AlQuran.cloud edition used only when a reference isn't available locally, e.g. en.sahih, fr.hamidullah."
			)
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.translationEdition)
					.setValue(this.plugin.settings.translationEdition)
					.onChange(async (v) => {
						this.plugin.settings.translationEdition = v.trim() || DEFAULT_SETTINGS.translationEdition;
						await this.plugin.persist();
					})
			);

		new Setting(details)
			.setName("Online fallback tafsir edition")
			.setDesc("Optional AlQuran.cloud tafsir edition for the online fallback, e.g. ar.muyassar.")
			.addText((t) =>
				t.setValue(this.plugin.settings.tafsirEdition).onChange(async (v) => {
					this.plugin.settings.tafsirEdition = v.trim();
					await this.plugin.persist();
				})
			);

		new Setting(details)
			.setName("Clear content cache")
			.setDesc("Removes cached online-fallback responses. Downloaded/default resources are unaffected.")
			.addButton((b) =>
				b.setButtonText("Clear").onClick(() => {
					this.plugin.cache.deletePrefix("");
					new Notice("Falah cache cleared");
				})
			);
	}
}

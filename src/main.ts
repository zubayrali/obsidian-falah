import { Editor, Plugin, requestUrl } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { IslamicReference, QuranRef, RenderedText, parseRefUri, toUri } from "./ref";
import { AlQuranCloudProvider, HadithCdnProvider, errMsg } from "./providers";
import { logMessage } from "./log";
import { t } from "./i18n";
import { QuranSearchModal, SlashSuggest } from "./suggest";
import { livePreviewChips } from "./decorations";
import { falahPostProcessor } from "./postprocess";
import { ReferenceDetailModal } from "./detail";
import type { ReferenceContent } from "./data/schema";
import { DataStore } from "./data/store";
import type { FileIO } from "./data/store";
import { Registry } from "./data/registry";
import { CoreLoader, defaultCoreImportMap } from "./data/core";
import { AlQuranCloudSource, Fawazahmed0Source, QulSource } from "./data/download";
import type { DownloadSource, FetchJson } from "./data/download";
import { CacheEntry, LiveApiSource, QuranDataSource, RefCache, SourceChain } from "./data/source";
import type { DownloadSourceId } from "./data/schema";
import { makeFetchJson, makeFileIO } from "./data/obsidian-io";
import { ResourceStore } from "./data/content/resource-store";
import { InstallIndex } from "./data/content/install-index";
import { CatalogCache } from "./data/content/catalog-cache";
import { HadithCoreLoader } from "./data/hadith/core";
import { HadithResolver } from "./data/hadith/source";
import { Fawazahmed0HadithSource, AhmedBasetHadithSource, SunnahComHadithSource, OpenHadithCsvSource, type HadithSource } from "./data/hadith/sources";
import type { HadithCatalogEntry } from "./data/hadith/schema";
import { QuranReaderView, VIEW_TYPE_QURAN_READER } from "./reader";
import { QcfStore } from "./qcf/store";
import { BookmarksView, VIEW_TYPE_BOOKMARKS } from "./bookmarks/view";
import type { AvailabilitySnapshot } from "./bookmarks/resolve";
import { promptName } from "./bookmarks/prompt";
import type { Lens } from "./bookmarks/schema";
import { defaultVerseActions } from "./verse-actions";
import type { VerseAction } from "./verse-actions";
import { DEFAULT_FONT_BY_SCRIPT, fontStackFor } from "./fonts";
import { FontManager } from "./font-loader";
import { BookmarkStoreService } from "./bookmarks/store";
import { ReadingProgressService } from "./progress";
import { LocalWordByWordData } from "./data/word-data";
import { createDefaultAudioSourceResolver, HtmlAudioBackend, RECITERS, RecitationController } from "./audio/recitation";
import { createDefaultRecitationOfflineManager, type RecitationOfflineManager } from "./audio/offline";
import {
	VerseActionRegistry,
	ReferenceActionRegistry,
	SlashItemRegistry,
	FALAH_API_READY_EVENT,
	type FalahApi,
	type AyahRowDecorator,
	type VerseText,
	type SlashItem,
	type ReferenceAction,
} from "./api";
import { openReferenceActionMenu, resolveReferenceActionItems } from "./reference-menu";
import { DEFAULT_SETTINGS, type FalahSettings } from "./settings";
import { FalahSettingTab } from "./settings-tab";
import { registerCommands } from "./commands/register";
import { applyReaderTheme } from "./controllers/reader-theme";
import { QuranDiscoveryController } from "./controllers/quran-discovery";
import { BookmarkOperationsController } from "./controllers/bookmark-operations";
import { ReferenceActionsController } from "./controllers/reference-actions";
import { createPluginApi } from "./controllers/plugin-api";

export default class FalahPlugin extends Plugin {
	private settingsTab!: FalahSettingTab;
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
	private referenceActionRegistry = new ReferenceActionRegistry();
	private slashItemRegistry = new SlashItemRegistry();
	ayahRowDecorators: AyahRowDecorator[] = [];
	api!: FalahApi;
	fonts!: FontManager;
	bookmarks!: BookmarkStoreService;
	progress!: ReadingProgressService;
	recitation!: RecitationController;
	recitationOffline?: RecitationOfflineManager;
	wordData!: LocalWordByWordData;
	qcf!: QcfStore;
	private discovery!: QuranDiscoveryController;
	private bookmarkOperations!: BookmarkOperationsController;
	private referenceActions!: ReferenceActionsController;
	hadithIndex!: InstallIndex;

	registerVerseAction(action: VerseAction): () => void {
		return this.verseActionRegistry.register(action);
	}
	registerReferenceAction(action: ReferenceAction): () => void {
		return this.referenceActionRegistry.register(action);
	}
	referenceActionItems(ref: IslamicReference) {
		return resolveReferenceActionItems(this.referenceActionRegistry.list(), ref);
	}
	openReferenceActionMenu(ref: IslamicReference, event: MouseEvent): void {
		void openReferenceActionMenu(this.referenceActionRegistry.list(), ref, event);
	}
	verseActionList(): VerseAction[] {
		return this.verseActionRegistry.list();
	}
	registerSlashItem(item: SlashItem): () => void {
		return this.slashItemRegistry.register(item);
	}
	slashItemList(): SlashItem[] {
		return this.slashItemRegistry.list();
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
		this.recordRecent(toUri({ kind: "quran", surah, ayah }));
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
		this.applyReaderTheme();
		this.cache = new RefCache(data.cache ?? {}, () => void this.persist());

		this.fonts = new FontManager(this.app, `${this.manifest.dir ?? ""}/fonts`);
		void this.fonts.reload();
		this.registerEvent(
			this.app.workspace.on("window-open", (_win, w) => this.fonts.injectInto(w.document))
		);

		this.io = makeFileIO(this.app.vault.adapter, this.manifest.dir ?? "");
		this.qcf = new QcfStore(this.app.vault.adapter, this.manifest.dir ?? "", requestUrl);
		const vaultIo = makeFileIO(this.app.vault.adapter, "");
		this.bookmarks = new BookmarkStoreService(vaultIo, this.settings.bookmarksPath, () => Date.now(), 3000, {
			schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
			cancel: (timer) => window.clearTimeout(timer),
		});
		await this.bookmarks.load();
		this.bookmarks.setDefaultGroup(this.settings.bookmarkDefaultCollection);
		this.bookmarks.setRecentCap(this.settings.bookmarkRecentCount);
		this.progress = new ReadingProgressService(vaultIo, this.settings.progressPath, {
			scheduler: {
				setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
				clearTimeout: (handle) => window.clearTimeout(handle),
			},
			onPersistError: (error) => logMessage(errMsg(error), "warn"),
		});
		await this.progress.load();
		this.store = new DataStore(this.io);
		this.registry = new Registry(this.io, this.store, new CoreLoader(defaultCoreImportMap));
		this.wordData = new LocalWordByWordData(this.store, this.registry);
		const surahCounts = new Map((await this.registry.core.getSurahs()).map((surah) => [surah.number, surah.ayahCount]));
		const reciter = RECITERS.find((item) => item.id === this.settings.reciterId) ?? RECITERS[0];
			this.recitation = new RecitationController(
			new HtmlAudioBackend(),
			reciter,
			(surah) => surahCounts.get(surah) ?? 1,
				createDefaultAudioSourceResolver(),
			);
			this.recitationOffline = createDefaultRecitationOfflineManager(
				(surah) => surahCounts.get(surah) ?? 0,
			);
		this.registerVerseAction({
			id: "recitation",
			items: (ctx) => [{
				title: t().audioPlayVerse,
				icon: "volume-2",
				section: "falah-audio",
				onClick: () => this.recitation.dispatch({ type: "play", ref: { surah: ctx.surah, ayah: ctx.ayah } }),
			}],
		});
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
		this.hadithIndex = new InstallIndex(this.io, "hdata/index.json");
		this.hadithFetchText = (url) =>
			requestUrl({ url, throw: false }).then((r) => {
				if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
				return r.text;
			});
		this.hadith = new HadithResolver(hadithStore, this.hadithIndex, new HadithCoreLoader(), {
			getHadith: (ref) => hadithProvider.getHadith(ref),
		});
		this.hadithSources = [
			new Fawazahmed0HadithSource(),
			new AhmedBasetHadithSource(),
			new SunnahComHadithSource(
				() => this.settings.hadithSunnahApiKey ?? "",
				async (url, apiKey) => {
					const response = await requestUrl({
						url,
						throw: false,
						headers: { "X-API-Key": apiKey },
					});
					if (response.status < 200 || response.status >= 300) {
						throw new Error(`HTTP ${response.status}`);
					}
					return response.json as unknown;
				},
			),
			new OpenHadithCsvSource(),
		];
		this.hadithCatalog = new CatalogCache<HadithCatalogEntry>(this.io, (key) => `hdata/catalog-${key}.json`);
		this.discovery = new QuranDiscoveryController({
			app: this.app,
			registry: this.registry,
			quranData: this.quranData,
			navigate: (surah, ayah) => this.navigateReaderTo(surah, ayah),
		});
		this.bookmarkOperations = new BookmarkOperationsController({
			app: this.app,
			bookmarks: this.bookmarks,
			quranData: this.quranData,
			hadith: this.hadith,
			bookmarksPath: () => this.settings.bookmarksPath,
		});
		this.referenceActions = new ReferenceActionsController({
			cache: this.cache,
			sourceChain: this.sourceChain,
			hadith: this.hadith,
			settings: () => this.settings,
		});

		this.registerEditorSuggest(new SlashSuggest(this));
		this.registerEditorExtension(livePreviewChips(this));
		this.registerMarkdownPostProcessor(falahPostProcessor(this));
		this.settingsTab = new FalahSettingTab(this);
		this.addSettingTab(this.settingsTab);

		this.registerView(VIEW_TYPE_QURAN_READER, (leaf) => new QuranReaderView(leaf, this));
		this.registerView(VIEW_TYPE_BOOKMARKS, (leaf) => new BookmarksView(leaf, this));
		this.api = createPluginApi(this);
		// Announce a fresh API on every load — a disable/re-enable of Falah produces a
		// NEW api object with empty registries, so companions must know to re-register.
		this.app.workspace.trigger(FALAH_API_READY_EVENT, this.api);
		registerCommands({
			plugin: this,
			addCommand: (command) => { this.addCommand(command); },
			addRibbonIcon: (icon, title, callback) => { this.addRibbonIcon(icon, title, callback); },
			findReaderLeaf: () => this.findReaderLeaf(),
		});
	}

	async persist(): Promise<void> {
		await this.saveData({ settings: this.settings, cache: this.cache.data });
	}

	openDetail(ref: IslamicReference): void {
		this.recordRecent(toUri(ref));
		new ReferenceDetailModal(this, ref).open();
	}

	/** Record an explicit read as a Recent entry (debounced persist in the store). */
	recordRecent(anchor: string): void {
		this.bookmarks.pushRecent(anchor);
	}

	onunload(): void {
		void this.bookmarks?.flush();
		void this.progress?.flush();
		this.recitation?.dispose();
	}

	/** Ask the user to choose a verse, via the same search modal `/quran` uses.
	 *  Resolves undefined if they dismiss without choosing. Exposed on the API so
	 *  companions can reuse this picker instead of building their own. */
	pickVerse(): Promise<QuranRef | undefined> {
		return new Promise((resolve) => {
			new QuranSearchModal(this, resolve).open();
		});
	}

	/** Prompts for a new collection name, creates it, and files this bookmark
	 *  into it. Backs the verse action's "New collection…" submenu entry. */
	async newCollectionFor(anchor: string, lens?: Lens): Promise<void> {
		const name = await promptName(this.app, t().bookmarkNewCollectionPrompt, "", t().bookmarkPromptCreate);
		if (!name) return;
		await this.bookmarks.createGroup(name);
		await this.bookmarks.add({ anchor, lens, group: name });
	}

	/** CSS font-family stack for the Quran Arabic of a given script. */
	arabicFontStack(script: string): string {
		return fontStackFor(this.settings.fontByScript[script] || DEFAULT_FONT_BY_SCRIPT[script] || "");
	}

	openDetailFromUri(uri: string): void {
		const ref = parseRefUri(uri);
		if (ref) this.openDetail(ref);
		else logMessage(t().noticeUnsupportedReference(uri), "warn");
	}

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
		this.discovery.invalidateIndex();
		const leaf = this.findReaderLeaf();
		if (leaf && leaf.view instanceof QuranReaderView) void leaf.view.refresh();
	}

	openQuranBrowse(): void {
		this.discovery.openBrowse();
	}

	async openOfflineSearch(): Promise<void> {
		await this.discovery.openOfflineSearch();
	}

	/** Re-render the open reader's ayah rows (re-runs row decorators), e.g. after a
	 *  companion plugin's own index changes. No-op if no reader is open or it hasn't
	 *  loaded yet. Distinct from refreshReader() above (toolbar/dropdown refresh) —
	 *  this only touches row content, not the toolbar. Backs FalahApi.refreshReader. */
	refreshReaderRows(): void {
		const leaf = this.findReaderLeaf();
		if (leaf && leaf.view instanceof QuranReaderView) leaf.view.refreshRows();
	}

	openLibrarySettings(): void {
		this.settingsTab.openLibrary();
	}

	/** Pushes the reader-theming settings onto `document.body` as the same CSS custom
	 *  properties/classes `styles.css` already reads (`--falah-reader-*`,
	 *  `falah-hide-*`) — pure CSS reactivity, no reader rebuild needed. Called once on
	 *  load and again from the Reader settings zone after every change. */
	applyReaderTheme(): void {
		applyReaderTheme(this.settings);
	}

	async openReader(surah?: number, ayah?: number): Promise<void> {
		if (surah === undefined) {
			const resume = this.settings.progressEnabled ? this.progress.resumeTarget() : undefined;
			surah = resume?.surah ?? 1;
			ayah = resume?.ayah;
		}
		if (ayah !== undefined) this.recordRecent(toUri({ kind: "quran", surah, ayah }));
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

	/** Open (or focus) the single Bookmarks view in the right sidebar. */
	async openBookmarks(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_BOOKMARKS)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false)!;
			await leaf.setViewState({ type: VIEW_TYPE_BOOKMARKS, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	/** Installed hadith collection ids, for the bookmarks view's availability
	 *  snapshot (Task 3's resolveRow). */
	async installedHadithCollections(): Promise<string[]> {
		return this.bookmarkOperations.installedHadithCollections();
	}

	/** Snapshot of what's installed, for degrading bookmark rows (Task 3's
	 *  resolveRow). Single source of truth — the bookmarks view and
	 *  cleanupBookmarks() both delegate here rather than rebuilding the sets. */
	async availabilitySnapshot(): Promise<AvailabilitySnapshot> {
		return this.bookmarkOperations.availabilitySnapshot();
	}

	async exportBookmarks(): Promise<void> {
		await this.bookmarkOperations.export();
	}

	async importBookmarks(text: string): Promise<void> {
		await this.bookmarkOperations.import(text);
	}

	async cleanupBookmarks(): Promise<void> {
		await this.bookmarkOperations.cleanup();
	}

	async getDetail(ref: IslamicReference): Promise<ReferenceContent> {
		return this.referenceActions.getDetail(ref);
	}

	renderedText(content: ReferenceContent): RenderedText {
		return this.referenceActions.renderedText(content);
	}

	/** Insert at cursor: reference-only inline, callout with fetched text on an empty line. */
	async insertReference(editor: Editor, ref: IslamicReference): Promise<void> {
		await this.referenceActions.insert(editor, ref);
	}

	refUnderCursor(editor: Editor): IslamicReference | null {
		return this.referenceActions.refUnderCursor(editor);
	}

	async copyReferenceText(ref: IslamicReference): Promise<void> {
		await this.referenceActions.copyText(ref);
	}

	/** Refresh cached content; if the cursor is in a reference callout, rewrite its body too. */
	async refreshAtCursor(editor: Editor): Promise<void> {
		await this.referenceActions.refreshAtCursor(editor);
	}
}

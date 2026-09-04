// The Quran Reader — a persistent, offline ItemView for reading a full surah with
// switchable script/translation/tafsir. Docks beside notes or pops out to its own
// OS window (Quran Reader Phase 1). Obsidian-runtime module (not vitest-importable).

import { ItemView, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type FalahPlugin from "./main";
import type { ResourceDescriptor, Surah } from "./data/schema";
import type { ReadingAyah, SurahReading } from "./data/source";
import type { VerseContext, VerseView } from "./verse-actions";
import { parseAyahKey } from "./ref";
import { errMsg } from "./providers";
import { t } from "./i18n";
import type { QuranNav } from "./nav/schema";
import { RECITERS } from "./audio/recitation";
import type { RecitationState } from "./audio/recitation";
import { ReaderAudioControls } from "./reader/audio-controls";
import {
	loadReaderEnhancements,
	loadWordRowsForAyahKeys,
	renderComparisonGrid,
	renderInteractiveArabic,
	type ComparisonRow,
	type ComparisonFailure,
} from "./reader/enhancements";
import {
	DEFAULT_READER_FONT,
	MAX_READER_FONT,
	MIN_READER_FONT,
	type ReaderState,
} from "./reader/state";
import { renderReaderToolbar } from "./reader/toolbar";
import { readerSurahName, surahNameFontLigature } from "./reader/surah-name";
import { openVerseActionMenu, renderTafsirBlock } from "./reader/verse-menu";
import type { WordViewModel } from "./word-by-word/model";
import { closeWordInspector, openWordInspector } from "./word-by-word/inspector";
import { pageOf } from "./nav/locate";
import { QCF_PAGE_COUNT } from "./qcf/schema";
import { renderMushafPage, renderMushafToolbar, type MushafViewActions } from "./qcf/view";

export const VIEW_TYPE_QURAN_READER = "falah-quran-reader";

const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const BISMILLAH_LIGATURE = "﷽";
export class QuranReaderView extends ItemView implements VerseView {
	private state: ReaderState;
	private toolbarEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	/** Per-verse tafsir overrides (ephemeral; cleared on surah change). */
	private perVerseTafsir = new Map<string, Set<string>>();
	/** Cache of on-demand per-verse tafsir fetches, keyed `${tafsirId}|${ayahKey}`.
	 *  `null` = fetched but the verse isn't covered / tafsir gone. */
	private tafsirCache = new Map<string, { name?: string; text: string } | null>();
	/** The surah currently rendered (for single-row re-render on toggle). */
	private renderedSurah?: number;
	private currentReading?: SurahReading;
	private readerSurahs: Surah[] = [];
	private readerResources: ResourceDescriptor[] = [];
	private comparisonRows = new Map<string, ComparisonRow>();
	private comparisonFailures: ComparisonFailure[] = [];
	private wordRows = new Map<string, WordViewModel[]>();
	private wordResourceMissing = false;
	private progressFramePending = false;
	private audioControls: ReaderAudioControls;
	private readerNav?: QuranNav;
	private followedRecitationKey?: string;

	constructor(leaf: WorkspaceLeaf, private plugin: FalahPlugin) {
		super(leaf);
		this.state = {
			mode: "study",
			surah: 1,
			script: plugin.settings.arabicScript,
			translationId: plugin.settings.translationResourceId,
			tafsirId: plugin.settings.tafsirResourceId,
			compareIds: [],
			fontSize: DEFAULT_READER_FONT,
		};
		this.audioControls = new ReaderAudioControls(plugin.recitation, {
			currentRef: () => ({ surah: this.state.surah, ayah: this.currentAyah() }),
			reciterName: () => RECITERS.find((reciter) => reciter.id === plugin.settings.reciterId)?.name ?? t().setReciterName,
			toolbar: () => this.toolbarEl,
			body: () => this.bodyEl,
			onRecitationChange: (state) => this.syncReadingRecitation(state),
		});
	}

	getViewType(): string {
		return VIEW_TYPE_QURAN_READER;
	}
	getDisplayText(): string {
		return t().readerDisplayName;
	}
	getIcon(): string {
		return "book-open";
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") Object.assign(this.state, state as Partial<ReaderState>);
		if (this.state.mode !== "reading") this.state.mode = "study";
		this.state.readingTextFont = this.state.readingTextFont === true;
		if (this.state.page !== undefined) this.state.page = Math.max(1, Math.min(QCF_PAGE_COUNT, Math.round(this.state.page)));
		// Let the base View record navigation/ephemeral state; skipping this can make
		// Obsidian treat the view as not-restored and open a fresh empty tab.
		await super.setState(state, result);
		if (this.bodyEl) await this.render();
	}

	async onOpen(): Promise<void> {
		closeWordInspector(this.contentEl.ownerDocument);
		this.contentEl.empty();
		this.contentEl.addClass("falah-reader");
		this.applyStudyFontSize();
		this.toolbarEl = this.contentEl.createDiv({ cls: "falah-reader-toolbar" });
		this.bodyEl = this.contentEl.createDiv({ cls: "falah-reader-body" });
		this.registerDomEvent(this.bodyEl, "scroll", () => this.scheduleProgressCapture(), { passive: true });
		this.contentEl.tabIndex = -1;
		this.registerDomEvent(this.contentEl, "keydown", (event) => this.handleReadingKey(event));
		this.audioControls.connect();
		await this.render();
	}

	private scheduleProgressCapture(): void {
		if (!this.plugin.settings.progressEnabled || this.progressFramePending) return;
		this.progressFramePending = true;
		const win = this.bodyEl.ownerDocument.defaultView;
		(win?.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.requestAnimationFrame(callback)))(() => {
			this.progressFramePending = false;
			this.captureProgress();
		});
	}

	private captureProgress(): void {
		if (this.state.mode === "reading") {
			this.plugin.progress.record({ surah: this.state.surah, ayah: this.currentAyah(), scrollAnchor: `${this.state.surah}:${this.currentAyah()}` });
			return;
		}
		const rows = Array.from(this.bodyEl.querySelectorAll<HTMLElement>(".falah-reader-ayah"));
		if (!rows.length) return;
		const top = this.bodyEl.getBoundingClientRect().top + 8;
		const row = rows.find((candidate) => candidate.getBoundingClientRect().bottom >= top) ?? rows.at(-1);
		const ayah = Number(row?.dataset.ayah);
		const scrollAnchor = row?.dataset.ayahKey;
		if (!scrollAnchor || !Number.isInteger(ayah)) return;
		this.plugin.progress.record({ surah: this.state.surah, ayah, scrollAnchor });
	}

	/** Rebuild the toolbar so a just-installed/removed translation or tafsir appears
	 *  in the dropdowns without reopening the view. Toolbar only — the reading
	 *  position and current selections are preserved. Called by plugin.refreshReader
	 *  after a download/import/remove in the settings tab. */
	async refresh(): Promise<void> {
		if (!this.toolbarEl) return;
		if (this.state.mode === "reading") {
			await this.render();
			return;
		}
		try {
			const [surahs, resources, nav] = await Promise.all([
				this.plugin.registry.core.getSurahs(),
				this.plugin.quranData.listResources(),
				this.plugin.registry.core.getNav(),
			]);
			// If the currently-selected translation/tafsir was just removed, reset it
			// to "none" so the dropdown truly lands on "No …" and the body stops
			// trying to load a resource that no longer exists.
			const ids = new Set(resources.map((r) => r.id));
			let changed = false;
			if (this.state.translationId && !ids.has(this.state.translationId)) {
				this.state.translationId = "";
				changed = true;
			}
			if (this.state.tafsirId && !ids.has(this.state.tafsirId)) {
				this.state.tafsirId = "";
				changed = true;
			}
			this.buildToolbar(surahs, resources, nav);
			if (changed) {
				this.persistState();
				await this.renderBody();
			}
		} catch {
			// A transient list failure shouldn't disrupt an open reader; leave the
			// existing toolbar in place.
		}
	}

	/** Public: re-render the ayah rows, preserving scroll position. Used by
	 *  FalahApi.refreshReader so companion plugins (e.g. Tadabbur) can refresh their
	 *  row decorations after their own data changes — distinct from refresh(), which
	 *  rebuilds the toolbar for a locally-changed resource list. renderBody() itself
	 *  empties the scroll container (.falah-reader-body), so we save/restore scrollTop
	 *  around it here rather than inside renderBody, which navigation also relies on
	 *  for its own scroll-to-selected-ayah behavior. */
	refreshRows(): void {
		if (this.state.mode === "reading") return;
		const body = this.bodyEl;
		const prev = body.scrollTop;
		void this.renderBody().then(() => {
			body.scrollTop = prev;
		});
	}

	/** Public entry point used by plugin.openReader when a reader is already open. */
	navigateTo(surah: number, ayah?: number): void {
		this.state.surah = surah;
		this.state.ayah = ayah;
		if (this.state.mode === "reading" && this.readerNav) {
			this.state.page = pageOf(this.readerNav, surah, ayah ?? 1)?.n ?? 1;
		}
		this.persistState();
		void this.render();
	}

	private persistState(): void {
		// Persist the reader's surah/selection/font immediately after a change so it
		// survives a reload (Obsidian re-serializes leaves and calls getState()).
		this.plugin.app.workspace.requestSaveLayout();
	}

	/** Rebuild the toolbar (surah/script/translation/tafsir dropdowns need current
	 *  installed-resource + surah lists) and the body. */
	private async render(): Promise<void> {
		let surahs: Surah[];
		let resources: ResourceDescriptor[];
		let nav: QuranNav;
		try {
			[surahs, resources, nav] = await Promise.all([
				this.plugin.registry.core.getSurahs(),
				this.plugin.quranData.listResources(),
				this.plugin.registry.core.getNav(),
			]);
		} catch (e) {
			this.toolbarEl.empty();
			this.bodyEl.empty();
			this.bodyEl.createDiv({ cls: "falah-error", text: errMsg(e) });
			return;
		}
		this.readerNav = nav;
		this.readerSurahs = surahs;
		this.readerResources = resources;
		this.contentEl.toggleClass("falah-reader-reading-mode", this.state.mode === "reading");
		if (this.state.mode === "reading") {
			await this.renderReadingMode(nav);
			return;
		}
		this.toolbarEl.removeClass("falah-mushaf-toolbar");
		this.buildToolbar(surahs, resources, nav);
		await this.renderBody();
	}

	/** Best-known current ayah for juz-boundary lookups (Step 3). The reader
	 *  doesn't yet track precise scroll position, so this falls back to the
	 *  selected/navigated-to ayah, or the surah's first ayah — good enough to
	 *  step juz prev/next from the surah's start (precise scroll tracking is
	 *  later Reading-Progress work). */
	private currentAyah(): number {
		return this.state.ayah ?? 1;
	}

	private buildToolbar(surahs: Surah[], resources: ResourceDescriptor[], nav: QuranNav): void {
		this.readerResources = resources;
		renderReaderToolbar({
			container: this.toolbarEl,
			state: this.state,
			surahs,
			resources,
			nav,
			currentAyah: this.currentAyah(),
			vaultFontFamilies: this.plugin.fonts.vaultFamilies(),
			configuredFont: this.plugin.settings.fontByScript[this.state.script],
			canPopOut: this.containerEl.ownerDocument === document,
				actions: {
					showReading: () => void this.switchMode("reading", nav),
				navigateTo: (surah, ayah) => this.navigateTo(surah, ayah),
				selectSurah: (surah) => this.goSurah(surah),
				selectScript: (script) => {
					this.state.script = script;
					this.persistState();
					void this.render();
				},
				selectFont: (family) => {
					this.plugin.settings.fontByScript[this.state.script] = family;
					void this.plugin.persist();
					void this.renderBody();
				},
				selectTranslation: (id) => this.selectEdition("translationId", id, true),
				selectTafsir: (id) => this.selectEdition("tafsirId", id),
				selectComparisons: (ids) => {
					this.state.compareIds = ids;
					this.persistState();
					void this.renderBody();
				},
				changeFontSize: (delta) => this.setFont(this.state.fontSize + delta),
				popOut: () => this.plugin.app.workspace.moveLeafToPopout(this.leaf),
					setOptionsOpen: (open) => {
						this.state.toolbarOptionsOpen = open;
						this.persistState();
						this.buildToolbar(surahs, resources, nav);
				},
				mountAudio: (parent) => this.audioControls.mount(parent),
			},
		});
	}

	private selectEdition(key: "translationId" | "tafsirId", id: string, rebuildToolbar = false): void {
		this.state[key] = id;
		this.persistState();
		if (rebuildToolbar) void this.render();
		else void this.renderBody();
	}

	private goSurah(n: number): void {
		if (n < 1 || n > 114 || n === this.state.surah) return;
		this.state.surah = n;
		this.state.ayah = undefined;
		this.persistState();
		void this.render();
	}

	private setFont(px: number): void {
		this.state.fontSize = Math.max(MIN_READER_FONT, Math.min(MAX_READER_FONT, px));
		this.applyStudyFontSize();
		this.persistState();
	}

	private applyStudyFontSize(): void {
		this.contentEl.style.setProperty("--falah-reader-arabic-font-size", `${this.state.fontSize}px`);
		this.contentEl.style.setProperty("--falah-mushaf-scale", String(this.state.fontSize / DEFAULT_READER_FONT));
	}

	private async renderBody(): Promise<void> {
		const body = this.bodyEl;
		if (this.renderedSurah !== this.state.surah) {
			// New surah → drop the previous surah's per-verse overrides + cache.
			this.perVerseTafsir.clear();
			this.tafsirCache.clear();
			this.renderedSurah = this.state.surah;
		}
		body.empty();
		body.createDiv({ cls: "falah-loading", text: t().readerLoading });

		let reading: SurahReading;
		try {
			reading = await this.plugin.quranData.getSurahReading(this.state.surah, {
				script: this.state.script,
				translationId: this.state.translationId || undefined,
				tafsirId: this.state.tafsirId || undefined,
			});
		} catch (e) {
			body.empty();
			body.createDiv({ cls: "falah-error", text: errMsg(e) });
			return;
		}
		this.currentReading = reading;
		const resources = this.state.compareIds.length
			? await this.plugin.quranData.listResources()
			: [];
		const enhancements = await loadReaderEnhancements(
			reading,
			resources,
			this.state.compareIds,
			this.plugin.settings.wordAnalysisEnabled && this.plugin.settings.wordResourceId ? {
				resourceId: this.plugin.settings.wordResourceId,
				showTranslation: this.plugin.settings.wordShowTranslation,
				showTransliteration: this.plugin.settings.wordShowTransliteration,
			} : undefined,
			{ quran: this.plugin.quranData, words: this.plugin.wordData },
		);
		this.wordRows = enhancements.wordRows;
		this.wordResourceMissing = enhancements.wordResourceMissing;
			this.comparisonRows = enhancements.comparisonRows;
			this.comparisonFailures = enhancements.comparisonFailures;

		// Build detached, append once (avoid per-ayah reflow).
		const wrap = createDiv({ cls: "falah-reader-content" });
		const head = wrap.createDiv({ cls: "falah-reader-head" });
		const selectedTranslation = this.state.translationId
			? this.readerResources.find((resource) =>
				resource.type === "translation" && resource.id === this.state.translationId
			)
			: undefined;
			head.createDiv({
				cls: "falah-reader-surah-arabic falah-surah-name-glyph",
			text: surahNameFontLigature(reading.surah.number),
			attr: { dir: "ltr", role: "img", "aria-label": reading.surah.nameArabic },
			});
			head.createDiv({ cls: "falah-reader-title", text: readerSurahName(reading.surah, selectedTranslation) });
			head.createDiv({ cls: "falah-reader-subtitle", text: t().readerAyahCount(reading.surah.ayahCount) });
			if (this.comparisonFailures.length) {
				head.createDiv({
					cls: "falah-reader-compare-warning",
					text: t().readerCompareLoadFailed(this.comparisonFailures.map((failure) => failure.name).join(", ")),
				});
			}
			if (reading.showBismillah) {
				const bismillah = wrap.createDiv({ cls: "falah-reader-bismillah" });
				bismillah.createDiv({
					cls: "falah-reader-bismillah-glyph",
					text: BISMILLAH_LIGATURE,
					attr: { dir: "rtl", lang: "ar", role: "img", "aria-label": BISMILLAH },
				});
				if (reading.bismillahTranslation) {
					bismillah.createDiv({
						cls: "falah-reader-bismillah-translation",
						text: reading.bismillahTranslation,
					});
				}
			}
		if (this.wordResourceMissing) {
			const warning = wrap.createDiv({ cls: "falah-warning" });
			warning.createSpan({ text: t().readerWordDataMissing });
			const openLibrary = warning.createEl("button", { text: t().readerOpenLibrary });
			openLibrary.onclick = () => this.plugin.openLibrarySettings();
		}
		for (const a of reading.ayahs) wrap.appendChild(this.buildAyahRow(a, reading));

		body.empty();
		body.appendChild(wrap);

		if (this.state.ayah !== undefined) {
			const selectedAyah = this.state.ayah;
			body.ownerDocument.defaultView?.requestAnimationFrame(() => {
				const target = body.querySelector<HTMLElement>(`.falah-reader-ayah[data-ayah="${selectedAyah}"]`);
				// Rows can be much taller than the viewport when tafsir/comparisons are
				// enabled. Center the Arabic line itself so the selected words never land
				// above the scrollport where they appear to be missing.
				const anchor = target?.querySelector<HTMLElement>(".falah-reader-arabic") ?? target;
				if (!anchor) return;
				const bodyRect = body.getBoundingClientRect();
				const anchorRect = anchor.getBoundingClientRect();
				const anchorTop = anchorRect.top - bodyRect.top + body.scrollTop;
				body.scrollTop = Math.max(0, anchorTop - (body.clientHeight - anchorRect.height) / 2);
			});
		}
		this.scheduleProgressCapture();
	}

	private async switchMode(mode: "reading" | "study", nav = this.readerNav): Promise<void> {
		if (this.state.mode === mode) return;
		if (mode === "reading" && nav) this.state.page = pageOf(nav, this.state.surah, this.currentAyah())?.n ?? 1;
		this.state.mode = mode;
		this.persistState();
		await this.render();
	}

	private readingActions(nav: QuranNav): MushafViewActions {
		const inspectorOptions = {
			glass: this.plugin.settings.wordInspectorGlass,
			draggable: this.plugin.settings.wordInspectorDraggable,
			showDictionary: this.plugin.settings.wordInspectorShowDictionary,
			showGrammar: this.plugin.settings.wordInspectorShowGrammar,
		};
		const goLocation = (surah: number, ayah = 1) => {
			if (surah < 1 || surah > 114) return;
			this.state.surah = surah;
			this.state.ayah = ayah;
			this.state.page = pageOf(nav, surah, ayah)?.n ?? 1;
			this.persistState();
			void this.renderReadingMode(nav);
		};
		const goPage = (page: number) => {
			const next = Math.max(1, Math.min(QCF_PAGE_COUNT, page));
			const location = nav.pages[next - 1];
			this.state.page = next;
			if (location) {
				this.state.surah = location.surah;
				this.state.ayah = location.ayah;
			}
			this.persistState();
			void this.renderReadingMode(nav);
		};
		return {
			navigateTo: goLocation,
			selectSurah: (surah) => goLocation(surah),
			previousPage: () => goPage((this.state.page ?? 1) - 1),
			nextPage: () => goPage((this.state.page ?? 1) + 1),
			selectPage: goPage,
				selectVerse: (surah, ayah) => {
				this.state.surah = surah;
				this.state.ayah = ayah;
				this.persistState();
					this.highlightReadingVerse(`${surah}:${ayah}`, nav);
				},
				openVerseActions: (surah, ayah, event) => {
					void this.openReadingVerseMenu(surah, ayah, event, nav);
				},
			studyVerse: (surah, ayah) => {
				this.state.surah = surah;
				this.state.ayah = ayah;
				void this.switchMode("study", nav);
			},
			inspectWord: (word, anchor) => {
				if (this.plugin.settings.wordAnalysisEnabled) openWordInspector(this.app, word, anchor, inspectorOptions);
			},
			showStudy: () => void this.switchMode("study", nav),
			setOptionsOpen: (open) => {
				this.state.toolbarOptionsOpen = open;
				this.persistState();
				void this.renderReadingMode(nav);
			},
			changeFontSize: (delta) => {
				this.setFont(this.state.fontSize + delta);
				void this.renderReadingMode(nav);
			},
			selectTextFont: (family) => {
				this.state.readingTextFont = !!family;
				if (family) this.plugin.settings.fontByScript.uthmani = family;
				this.persistState();
				void this.plugin.persist();
				void this.renderReadingMode(nav);
			},
			mountAudio: (parent) => this.audioControls.mount(parent),
			};
		}

		private async openReadingVerseMenu(
			surah: number,
			ayah: number,
			event: MouseEvent,
			nav: QuranNav,
		): Promise<void> {
			this.state.surah = surah;
			this.state.ayah = ayah;
			this.persistState();
			this.highlightReadingVerse(`${surah}:${ayah}`, nav);

			try {
				const content = await this.plugin.quranData.getContent(
					{ kind: "quran", surah, ayah },
					{
						script: this.state.script,
						translationId: this.state.translationId || undefined,
					},
				);
				if (this.state.mode !== "reading") return;
				await this.openVerseMenu({
					surah,
					ayah,
					ayahKey: `${surah}:${ayah}`,
					arabic: content.arabic,
					translation: content.translation,
					plugin: this.plugin,
					view: this,
				}, event);
			} catch (error) {
				console.warn(`Falah: could not open actions for ${surah}:${ayah}`, error);
			}
		}

		private async renderReadingMode(nav: QuranNav): Promise<void> {
		const pageNumber = this.state.page ?? pageOf(nav, this.state.surah, this.currentAyah())?.n ?? 1;
		this.state.page = pageNumber;
		const actions = this.readingActions(nav);
		renderMushafToolbar(
			this.toolbarEl,
			pageNumber,
			this.state.surah,
			this.currentAyah(),
			this.readerSurahs,
			this.readerResources,
			this.state.translationId,
			nav,
			{
				optionsOpen: !!this.state.toolbarOptionsOpen,
				fontSize: this.state.fontSize,
				useTextFont: !!this.state.readingTextFont,
				vaultFontFamilies: this.plugin.fonts.vaultFamilies(),
				configuredFont: this.plugin.settings.fontByScript.uthmani,
			},
			actions,
		);
		this.bodyEl.empty();
		this.bodyEl.scrollTop = 0;
		const loading = this.bodyEl.createDiv({ cls: "falah-mushaf-loading" });
		loading.createDiv({ cls: "falah-mushaf-loading-mark", text: "۞" });
		loading.createDiv({ text: t().readerPreparingMushaf });
		try {
			const page = await this.plugin.qcf.getPage(pageNumber);
			await this.plugin.qcf.ensurePageFonts(page, this.bodyEl.ownerDocument);
			const ayahKeys = page.lines.flatMap((line) => line.words.flatMap((word) => word.verse_key ? [word.verse_key] : []));
			const wordResult = await loadWordRowsForAyahKeys(
				ayahKeys,
					this.plugin.settings.wordAnalysisEnabled && this.plugin.settings.wordResourceId ? {
					resourceId: this.plugin.settings.wordResourceId,
					showTranslation: this.plugin.settings.wordShowTranslation,
					showTransliteration: this.plugin.settings.wordShowTransliteration,
				} : undefined,
				this.plugin.wordData,
			);
			if (this.state.mode !== "reading" || this.state.page !== pageNumber) return;
				renderMushafPage(
				this.bodyEl,
				page,
				`${this.state.surah}:${this.currentAyah()}`,
				wordResult.rows,
					actions,
					this.state.readingTextFont
						? { textFont: this.plugin.settings.fontByScript.uthmani }
						: undefined,
				);
			this.bodyEl.scrollTop = 0;
			this.syncReadingRecitation(this.plugin.recitation.snapshot());
			this.plugin.qcf.prefetch(pageNumber);
			this.scheduleProgressCapture();
		} catch (error) {
			this.bodyEl.empty();
			const failure = this.bodyEl.createDiv({ cls: "falah-mushaf-error" });
			failure.createEl("h3", { text: t().readerMushafErrorTitle });
			failure.createEl("p", { text: errMsg(error) });
			const retry = failure.createEl("button", { text: t().readerRetry });
			retry.onclick = () => void this.renderReadingMode(nav);
			const study = failure.createEl("button", { text: t().readerReturnToStudy });
			study.onclick = () => void this.switchMode("study", nav);
		}
	}

	private highlightReadingVerse(verseKey: string, nav: QuranNav): void {
		this.bodyEl.querySelectorAll<HTMLElement>(".falah-mushaf-word[data-verse-key]").forEach((word) => {
			word.toggleClass("is-selected", word.dataset.verseKey === verseKey);
		});
		const footer = this.bodyEl.querySelector<HTMLElement>(".falah-mushaf-page-footer");
		if (!footer) return;
		const [surah, ayah] = verseKey.split(":").map(Number);
		footer.empty();
		footer.createSpan({ text: "مُصْحَفُ الْمَدِينَةِ" });
		const study = footer.createEl("button", { cls: "falah-mushaf-study-verse", text: t().readerStudyAyah(verseKey) });
		study.onclick = () => {
			this.state.surah = surah;
			this.state.ayah = ayah;
			void this.switchMode("study", nav);
		};
	}

	private syncReadingRecitation(state: RecitationState): void {
		if (this.state.mode !== "reading" || !this.readerNav) return;
		const current = state.current;
		if (!current) {
			this.bodyEl.querySelectorAll(".falah-mushaf-word.is-reciting").forEach((word) => word.removeClass("is-reciting"));
			this.followedRecitationKey = undefined;
			return;
		}

		const location = pageOf(this.readerNav, current.surah, current.ayah);
		const currentPage = this.state.page ?? 1;
		const refChanged = this.state.surah !== current.surah || this.currentAyah() !== current.ayah;
		this.state.surah = current.surah;
		this.state.ayah = current.ayah;

		if (location && location.n !== currentPage) {
			this.state.page = location.n;
			this.persistState();
			void this.renderReadingMode(this.readerNav);
			return;
		}
		if (refChanged) this.persistState();

		const verseKey = `${current.surah}:${current.ayah}`;
		this.highlightReadingVerse(verseKey, this.readerNav);
		const words = Array.from(
			this.bodyEl.querySelectorAll<HTMLElement>(".falah-mushaf-word[data-verse-key]"),
		);
		for (const word of words) {
			word.toggleClass("is-reciting", state.playing && word.dataset.verseKey === verseKey);
		}

		if (!state.playing) {
			this.followedRecitationKey = undefined;
			return;
		}
		const firstWord = words.find((word) => word.dataset.verseKey === verseKey);
		if (firstWord && this.followedRecitationKey !== verseKey) {
			this.followedRecitationKey = verseKey;
			firstWord.scrollIntoView({ block: "center", behavior: "smooth" });
		}
	}

	private handleReadingKey(event: KeyboardEvent): void {
		if (event.key === "Escape" && this.state.mode !== "reading" && this.state.toolbarOptionsOpen && this.readerNav) {
			event.preventDefault();
			this.state.toolbarOptionsOpen = false;
			this.persistState();
			void this.render();
			return;
		}
		if (this.state.mode !== "reading" || !this.readerNav) return;
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
		if (event.key === "Escape") {
			event.preventDefault();
			void this.switchMode("study", this.readerNav);
		} else if (event.key === "ArrowLeft" || event.key === "PageUp") {
			event.preventDefault();
			this.readingActions(this.readerNav).previousPage();
		} else if (event.key === "ArrowRight" || event.key === "PageDown") {
			event.preventDefault();
			this.readingActions(this.readerNav).nextPage();
		}
	}

	// --- Per-verse actions (VerseView) ---

	isVerseTafsirShown(ayahKey: string, tafsirId: string): boolean {
		return this.perVerseTafsir.get(ayahKey)?.has(tafsirId) ?? false;
	}

	async toggleVerseTafsir(ayahKey: string, tafsirId: string): Promise<void> {
		let set = this.perVerseTafsir.get(ayahKey);
		if (!set) {
			set = new Set();
			this.perVerseTafsir.set(ayahKey, set);
		}
		if (set.has(tafsirId)) {
			set.delete(tafsirId);
		} else {
			set.add(tafsirId);
			const cacheKey = `${tafsirId}|${ayahKey}`;
			if (!this.tafsirCache.has(cacheKey)) {
				const parsed = parseAyahKey(ayahKey);
				const res = parsed
					? await this.plugin.quranData.getVerseTafsir(tafsirId, parsed.surah, parsed.ayah)
					: undefined;
				this.tafsirCache.set(cacheKey, res ?? null);
			}
		}
		this.rerenderAyahRow(ayahKey);
	}

	private verseContext(a: ReadingAyah): VerseContext {
		return {
			surah: this.state.surah,
			ayah: a.ayah,
			ayahKey: a.ayahKey,
			arabic: a.arabic,
			translation: a.translation,
			plugin: this.plugin,
			view: this,
		};
	}

	private async openVerseMenu(ctx: VerseContext, evt: MouseEvent): Promise<void> {
		await openVerseActionMenu(this.plugin.verseActionList(), ctx, evt, t().readerNoVerseActions);
	}

	private rerenderAyahRow(ayahKey: string): void {
		if (!this.currentReading) return;
		const a = this.currentReading.ayahs.find((x) => x.ayahKey === ayahKey);
		if (!a) return;
		const old = this.bodyEl.querySelector<HTMLElement>(`.falah-reader-ayah[data-ayah-key="${ayahKey}"]`);
		if (old) old.replaceWith(this.buildAyahRow(a, this.currentReading));
	}

	/** Build one detached ayah row: number, Arabic, ⋯ actions, translation, and
	 *  the tafsir blocks (global + per-verse). */
	private buildAyahRow(a: ReadingAyah, reading: SurahReading): HTMLElement {
		const row = createDiv({ cls: "falah-reader-ayah" });
		row.dataset.ayah = String(a.ayah);
		row.dataset.ayahKey = a.ayahKey;
		if (this.state.ayah === a.ayah) row.addClass("falah-reader-ayah-active");
		if (this.plugin.progress.furthestForSurah(this.state.surah)?.ayah === a.ayah) {
			row.addClass("falah-reader-ayah-furthest");
		}

		const ctx = this.verseContext(a);
		const menuBtn = row.createEl("button", {
			cls: "falah-reader-verse-menu falah-icon-button",
			attr: { "aria-label": t().readerVerseActions },
		});
		setIcon(menuBtn, "ellipsis");
		menuBtn.onclick = (e) => {
			e.preventDefault();
			void this.openVerseMenu(ctx, e);
		};
		// contextmenu fires on desktop right-click AND mobile long-press.
		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			void this.openVerseMenu(ctx, e);
		});

		const ar = row.createDiv({ cls: "falah-reader-arabic", attr: { dir: "rtl", lang: "ar" } });
		ar.style.fontFamily = this.plugin.arabicFontStack(this.state.script);
			const hasInteractiveWords = renderInteractiveArabic(ar, this.wordRows.get(a.ayahKey), (word, anchor) => {
				if (!this.plugin.settings.wordAnalysisEnabled) return;
				openWordInspector(this.app, word, anchor, {
					glass: this.plugin.settings.wordInspectorGlass,
					draggable: this.plugin.settings.wordInspectorDraggable,
					showDictionary: this.plugin.settings.wordInspectorShowDictionary,
					showGrammar: this.plugin.settings.wordInspectorShowGrammar,
				});
			});
		if (!hasInteractiveWords) ar.createSpan({ text: a.arabic });
		ar.createSpan({ cls: "falah-reader-ayah-num", text: ` ﴿${a.ayah}﴾` });

		if (a.translation) row.createDiv({ cls: "falah-reader-translation", text: a.translation });
		renderComparisonGrid(row, this.comparisonRows.get(a.ayahKey));

		this.renderTafsirBlocks(row, a, reading);

		for (const decorate of this.plugin.ayahRowDecorators) {
			try {
				decorate(row, ctx);
			} catch (e) {
				console.warn("Falah: ayah-row decorator threw", e);
			}
		}

		return row;
	}

	/** Global tafsir (from reading, under every verse) + per-verse overrides,
	 *  deduped by tafsir id. Global blocks stay collapsed; per-verse blocks open
	 *  with a remove control. */
	private renderTafsirBlocks(row: HTMLElement, a: ReadingAyah, reading: SurahReading): void {
		const globalId = this.state.tafsirId;
		if (globalId && a.tafsir) {
			renderTafsirBlock(
				row,
				t().readerTafsirBlockTitle(reading.tafsirName ?? globalId),
				a.tafsir,
				false,
				t().readerRemoveTafsirAriaLabel,
			);
		}
		for (const id of this.perVerseTafsir.get(a.ayahKey) ?? []) {
			if (id === globalId) continue; // already shown as the global block
			const cached = this.tafsirCache.get(`${id}|${a.ayahKey}`);
			if (cached === undefined) continue; // fetch in flight
			const title = t().readerTafsirThisVerse(cached?.name ?? id);
			const text = cached ? cached.text : t().readerTafsirUnavailable;
			renderTafsirBlock(row, title, text, true, t().readerRemoveTafsirAriaLabel, () => void this.toggleVerseTafsir(a.ayahKey, id));
		}
	}

	async onClose(): Promise<void> {
		closeWordInspector(this.contentEl.ownerDocument);
		this.audioControls.disconnect();
		await Promise.all([this.plugin.bookmarks.flush(), this.plugin.progress.flush()]);
		this.contentEl.empty();
	}
}

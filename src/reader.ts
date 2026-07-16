// The Quran Reader — a persistent, offline ItemView for reading a full surah with
// switchable script/translation/tafsir. Docks beside notes or pops out to its own
// OS window (Quran Reader Phase 1). Obsidian-runtime module (not vitest-importable).

import { ItemView, Menu } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type FalahPlugin from "./main";
import type { ArabicScript, ResourceDescriptor, Surah } from "./data/schema";
import type { ReadingAyah, SurahReading } from "./data/source";
import type { VerseContext, VerseMenuItem, VerseView } from "./verse-actions";
import { parseAyahKey } from "./ref";
import { bundledFontsForScript, dedupeFamilies } from "./fonts";
import { errMsg } from "./providers";

export const VIEW_TYPE_QURAN_READER = "falah-quran-reader";

const ARABIC_RE = /[؀-ۿ]/;
const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const DEFAULT_FONT = 28;
const MIN_FONT = 16;
const MAX_FONT = 64;

interface ReaderState {
	surah: number;
	ayah?: number;
	script: ArabicScript;
	translationId: string;
	tafsirId: string;
	fontSize: number;
}

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

	constructor(leaf: WorkspaceLeaf, private plugin: FalahPlugin) {
		super(leaf);
		this.state = {
			surah: 1,
			script: plugin.settings.arabicScript,
			translationId: plugin.settings.translationResourceId,
			tafsirId: plugin.settings.tafsirResourceId,
			fontSize: DEFAULT_FONT,
		};
	}

	getViewType(): string {
		return VIEW_TYPE_QURAN_READER;
	}
	getDisplayText(): string {
		return "Quran";
	}
	getIcon(): string {
		return "book-open";
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") Object.assign(this.state, state as Partial<ReaderState>);
		// Let the base View record navigation/ephemeral state; skipping this can make
		// Obsidian treat the view as not-restored and open a fresh empty tab.
		await super.setState(state, result);
		if (this.bodyEl) await this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("falah-reader");
		this.toolbarEl = this.contentEl.createDiv({ cls: "falah-reader-toolbar" });
		this.bodyEl = this.contentEl.createDiv({ cls: "falah-reader-body" });
		await this.render();
	}

	/** Rebuild the toolbar so a just-installed/removed translation or tafsir appears
	 *  in the dropdowns without reopening the view. Toolbar only — the reading
	 *  position and current selections are preserved. Called by plugin.refreshReader
	 *  after a download/import/remove in the settings tab. */
	async refresh(): Promise<void> {
		if (!this.toolbarEl) return;
		try {
			const [surahs, resources] = await Promise.all([
				this.plugin.registry.core.getSurahs(),
				this.plugin.quranData.listResources(),
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
			this.buildToolbar(surahs, resources);
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
		try {
			[surahs, resources] = await Promise.all([
				this.plugin.registry.core.getSurahs(),
				this.plugin.quranData.listResources(),
			]);
		} catch (e) {
			this.toolbarEl.empty();
			this.bodyEl.empty();
			this.bodyEl.createDiv({ cls: "falah-error", text: errMsg(e) });
			return;
		}
		this.buildToolbar(surahs, resources);
		await this.renderBody();
	}

	private buildToolbar(surahs: Surah[], resources: ResourceDescriptor[]): void {
		const t = this.toolbarEl;
		t.empty();

		const prev = t.createEl("button", { text: "‹", cls: "falah-reader-btn" });
		prev.disabled = this.state.surah <= 1;
		prev.onclick = () => this.goSurah(this.state.surah - 1);

		const surahSel = t.createEl("select", { cls: "dropdown" });
		for (const s of surahs) {
			surahSel.createEl("option", { value: String(s.number), text: `${s.number} · ${s.nameEnglish}` });
		}
		surahSel.value = String(this.state.surah);
		surahSel.onchange = () => this.goSurah(Number(surahSel.value));

		const next = t.createEl("button", { text: "›", cls: "falah-reader-btn" });
		next.disabled = this.state.surah >= 114;
		next.onclick = () => this.goSurah(this.state.surah + 1);

		const scriptSel = t.createEl("select", { cls: "dropdown" });
		scriptSel.createEl("option", { value: "uthmani", text: "Uthmani" });
		scriptSel.createEl("option", { value: "indopak", text: "Indo-Pak" });
		scriptSel.value = this.state.script;
		scriptSel.onchange = () => {
			this.state.script = scriptSel.value;
			this.persistState();
			void this.render();
		};

		const fontSel = t.createEl("select", { cls: "dropdown" });
		const fontFams = dedupeFamilies([
			...bundledFontsForScript(this.state.script).map((f) => f.family),
			...this.plugin.fonts.vaultFamilies(),
			this.plugin.settings.fontByScript[this.state.script],
		]);
		for (const fam of fontFams) fontSel.createEl("option", { value: fam, text: fam });
		fontSel.value = this.plugin.settings.fontByScript[this.state.script] ?? "";
		fontSel.onchange = () => {
			this.plugin.settings.fontByScript[this.state.script] = fontSel.value;
			void this.plugin.persist();
			void this.renderBody();
		};

		const trSel = t.createEl("select", { cls: "dropdown" });
		trSel.createEl("option", { value: "", text: "No translation" });
		for (const r of resources.filter((r) => r.type === "translation")) {
			trSel.createEl("option", { value: r.id, text: r.tier === "bundled" ? `${r.name} (default)` : r.name });
		}
		trSel.value = this.state.translationId;
		trSel.onchange = () => {
			this.state.translationId = trSel.value;
			this.persistState();
			void this.renderBody();
		};

		const tfSel = t.createEl("select", { cls: "dropdown" });
		tfSel.createEl("option", { value: "", text: "No tafsir" });
		for (const r of resources.filter((r) => r.type === "tafsir")) {
			tfSel.createEl("option", { value: r.id, text: r.name });
		}
		tfSel.value = this.state.tafsirId;
		tfSel.onchange = () => {
			this.state.tafsirId = tfSel.value;
			this.persistState();
			void this.renderBody();
		};

		const dec = t.createEl("button", { text: "A−", cls: "falah-reader-btn" });
		dec.onclick = () => this.setFont(this.state.fontSize - 2);
		const inc = t.createEl("button", { text: "A+", cls: "falah-reader-btn" });
		inc.onclick = () => this.setFont(this.state.fontSize + 2);

		// Pop-out button only when not already in a pop-out window.
		if (this.containerEl.ownerDocument === document) {
			const pop = t.createEl("button", { text: "⤢", cls: "falah-reader-btn", attr: { "aria-label": "Pop out" } });
			pop.onclick = () => this.plugin.app.workspace.moveLeafToPopout(this.leaf);
		}
	}

	private goSurah(n: number): void {
		if (n < 1 || n > 114 || n === this.state.surah) return;
		this.state.surah = n;
		this.state.ayah = undefined;
		this.persistState();
		void this.render();
	}

	private setFont(px: number): void {
		this.state.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, px));
		this.bodyEl
			.querySelectorAll<HTMLElement>(".falah-reader-arabic")
			.forEach((el) => (el.style.fontSize = `${this.state.fontSize}px`));
		this.persistState();
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
		body.createDiv({ cls: "falah-loading", text: "Loading…" });

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

		// Build detached, append once (avoid per-ayah reflow).
		const wrap = createDiv({ cls: "falah-reader-content" });
		const head = wrap.createDiv({ cls: "falah-reader-head" });
		head.createDiv({ cls: "falah-reader-title", text: reading.surah.nameEnglish });
		head.createDiv({
			cls: "falah-reader-subtitle",
			text: `${reading.surah.nameArabic} · ${reading.surah.ayahCount} ayahs`,
			attr: { dir: "rtl" },
		});
		if (reading.showBismillah) {
			wrap.createDiv({ cls: "falah-reader-bismillah", text: BISMILLAH, attr: { dir: "rtl" } });
		}
		for (const a of reading.ayahs) wrap.appendChild(this.buildAyahRow(a, reading));

		body.empty();
		body.appendChild(wrap);

		if (this.state.ayah !== undefined) {
			const target = body.querySelector<HTMLElement>(`.falah-reader-ayah[data-ayah="${this.state.ayah}"]`);
			target?.scrollIntoView({ block: "center" });
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
		const menu = new Menu();
		let any = false;
		for (const action of this.plugin.verseActionList()) {
			let items: VerseMenuItem[];
			try {
				items = await action.items(ctx);
			} catch {
				items = [];
			}
			for (const item of items) {
				any = true;
				this.addVerseMenuItem(menu, item);
			}
		}
		if (!any) menu.addItem((mi) => mi.setTitle("No verse actions available").setDisabled(true));
		menu.showAtMouseEvent(evt);
	}

	/** Add one VerseMenuItem to a Menu, recursing into `submenu` via Obsidian's
	 *  runtime `MenuItem.setSubmenu()`. That method isn't in the public typings but
	 *  ships in current Obsidian (used by core file menus); if it's ever absent the
	 *  submenu's children are flattened into the parent menu so nothing is lost.
	 *  ponytail: undocumented-but-stable API, guarded. */
	private addVerseMenuItem(menu: Menu, item: VerseMenuItem): void {
		let flattenInto: Menu | undefined;
		menu.addItem((mi) => {
			mi.setTitle(item.title);
			if (item.icon) mi.setIcon(item.icon);
			if (item.section) mi.setSection(item.section);
			if (item.checked !== undefined) mi.setChecked(item.checked);
			const setSubmenu = (mi as unknown as { setSubmenu?: () => Menu }).setSubmenu;
			if (item.submenu?.length && typeof setSubmenu === "function") {
				const sub = setSubmenu.call(mi);
				for (const child of item.submenu) this.addVerseMenuItem(sub, child);
			} else if (item.submenu?.length) {
				flattenInto = menu; // no submenu API — add children flat after this item
			} else if (item.onClick) {
				mi.onClick(() => void item.onClick!());
			}
		});
		if (flattenInto && item.submenu) {
			for (const child of item.submenu) this.addVerseMenuItem(flattenInto, child);
		}
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

		const ctx = this.verseContext(a);
		const menuBtn = row.createEl("button", {
			cls: "falah-reader-verse-menu",
			text: "⋯",
			attr: { "aria-label": "Verse actions" },
		});
		menuBtn.onclick = (e) => {
			e.preventDefault();
			void this.openVerseMenu(ctx, e);
		};
		// contextmenu fires on desktop right-click AND mobile long-press.
		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			void this.openVerseMenu(ctx, e);
		});

		const ar = row.createDiv({ cls: "falah-reader-arabic", attr: { dir: "rtl" } });
		ar.style.fontSize = `${this.state.fontSize}px`;
		ar.style.fontFamily = this.plugin.arabicFontStack(this.state.script);
		ar.createSpan({ text: a.arabic });
		ar.createSpan({ cls: "falah-reader-ayah-num", text: ` ﴿${a.ayah}﴾` });

		if (a.translation) row.createDiv({ cls: "falah-reader-translation", text: a.translation });

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
			this.renderTafsirBlock(row, `Tafsir · ${reading.tafsirName ?? globalId}`, a.tafsir, false);
		}
		for (const id of this.perVerseTafsir.get(a.ayahKey) ?? []) {
			if (id === globalId) continue; // already shown as the global block
			const cached = this.tafsirCache.get(`${id}|${a.ayahKey}`);
			if (cached === undefined) continue; // fetch in flight
			const title = `${cached?.name ?? id} (this verse)`;
			const text = cached ? cached.text : "Tafsir not available for this verse.";
			this.renderTafsirBlock(row, title, text, true, () => void this.toggleVerseTafsir(a.ayahKey, id));
		}
	}

	private renderTafsirBlock(
		row: HTMLElement,
		title: string,
		text: string,
		removable: boolean,
		onRemove?: () => void
	): void {
		const det = row.createEl("details", { cls: "falah-reader-tafsir" });
		det.open = removable; // per-verse opens on toggle; global stays collapsed
		const summary = det.createEl("summary");
		summary.createSpan({ text: title });
		if (removable && onRemove) {
			const x = summary.createEl("button", {
				cls: "falah-reader-tafsir-remove",
				text: "✕",
				attr: { "aria-label": "Remove tafsir" },
			});
			x.onclick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				onRemove();
			};
		}
		det.createDiv({ text, attr: { dir: ARABIC_RE.test(text) ? "rtl" : "ltr" } });
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}

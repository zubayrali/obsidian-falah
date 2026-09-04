import { setIcon } from "obsidian";
import type { ResourceDescriptor, Surah } from "../data/schema";
import type { QuranNav } from "../nav/schema";
import { juzOf } from "../nav/locate";
import { QCF_PAGE_COUNT, type QcfPage } from "./schema";
import { t } from "../i18n";
import type { WordViewModel } from "../word-by-word/model";
import { readerSurahName, surahNameFontLigature } from "../reader/surah-name";
import { bundledFontsForScript, dedupeFamilies, fontStackFor } from "../fonts";

export interface MushafViewActions {
	navigateTo(surah: number, ayah?: number): void;
	selectSurah(surah: number): void;
	previousPage(): void;
	nextPage(): void;
	selectPage(page: number): void;
	selectVerse(surah: number, ayah: number): void;
	openVerseActions(surah: number, ayah: number, event: MouseEvent): void;
	studyVerse(surah: number, ayah: number): void;
	inspectWord(word: WordViewModel, anchor: HTMLElement): void;
	showStudy(): void;
	setOptionsOpen(open: boolean): void;
	changeFontSize(delta: number): void;
	selectTextFont(family: string): void;
	mountAudio(parent: HTMLElement): void;
}

export interface MushafToolbarOptions {
	optionsOpen: boolean;
	fontSize: number;
	useTextFont: boolean;
	vaultFontFamilies: string[];
	configuredFont?: string;
}

function iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
	const button = parent.createEl("button", {
		cls: "falah-reader-btn falah-icon-button falah-mushaf-icon-button",
		attr: { "aria-label": label, title: label },
	});
	button.type = "button";
	setIcon(button, icon);
	return button;
}

function pageNavigationButton(
	parent: HTMLElement,
	direction: "previous" | "next",
	page: number,
	label: string,
): HTMLButtonElement {
	const button = parent.createEl("button", {
		cls: `falah-mushaf-bottom-button is-${direction}`,
		attr: { "aria-label": label, title: label },
	});
	button.type = "button";
	const addIcon = () => {
		const icon = button.createSpan({ cls: "falah-mushaf-bottom-icon" });
		setIcon(icon, direction === "previous" ? "chevron-left" : "chevron-right");
	};
	if (direction === "previous") addIcon();
	button.createSpan({ text: t().readerPageLabel(page) });
	if (direction === "next") addIcon();
	return button;
}

export function renderMushafToolbar(
	container: HTMLElement,
	page: number,
	currentSurah: number,
	currentAyah: number,
	surahs: Surah[],
	resources: ResourceDescriptor[],
	translationId: string,
	nav: QuranNav,
	options: MushafToolbarOptions,
	actions: MushafViewActions,
): void {
	container.empty();
	container.onkeydown = null;
	container.removeClass("falah-reader-toolbar-collapsed");
	container.addClass("falah-mushaf-toolbar");
	const strings = t();
	const controls = container.createDiv({ cls: "falah-reader-toolbar-controls" });
	const primary = controls.createDiv({ cls: "falah-reader-toolbar-primary" });
	const switcher = primary.createDiv({ cls: "falah-reader-mode-switch", attr: { role: "group", "aria-label": strings.readerModeLabel } });
		const reading = switcher.createEl("button", { cls: "is-active", text: strings.readerModeReading, attr: { "aria-pressed": "true" } });
		reading.type = "button";
		const study = switcher.createEl("button", { text: strings.readerModeStudy, attr: { "aria-pressed": "false" } });
		study.type = "button";
	study.onclick = () => actions.showStudy();

	const navBar = primary.createDiv({ cls: "falah-reader-toolbar-navigation falah-mushaf-navigation" });
	const surahGroup = navBar.createDiv({
		cls: "falah-reader-toolbar-group falah-reader-toolbar-surah",
		attr: { "data-label": strings.readerToolbarChapter },
	});
	const previousSurah = iconButton(surahGroup, "chevron-left", strings.detailPrevious);
	previousSurah.disabled = currentSurah <= 1;
	previousSurah.onclick = () => actions.selectSurah(currentSurah - 1);
		const surahSelect = surahGroup.createEl("select", { cls: "dropdown", attr: { "aria-label": strings.readerToolbarChapter } });
	const selectedTranslation = resources.find((resource) =>
		resource.type === "translation" && resource.id === translationId
	);
	for (const surah of surahs) {
		surahSelect.createEl("option", {
			value: String(surah.number),
			text: strings.readerSurahOption(
				surah.number,
				readerSurahName(surah, selectedTranslation),
				surah.nameArabic,
			),
		});
	}
	surahSelect.value = String(currentSurah);
	surahSelect.onchange = () => actions.selectSurah(Number(surahSelect.value));
	const nextSurah = iconButton(surahGroup, "chevron-right", strings.detailNext);
	nextSurah.disabled = currentSurah >= 114;
	nextSurah.onclick = () => actions.selectSurah(currentSurah + 1);

	const juzGroup = navBar.createDiv({
		cls: "falah-reader-toolbar-group falah-reader-toolbar-nav",
		attr: { "data-label": strings.readerToolbarPosition },
	});
	const currentJuz = juzOf(nav, currentSurah, currentAyah);
	const previousJuz = iconButton(juzGroup, "chevron-left", strings.readerJuzPrev);
	previousJuz.disabled = !currentJuz || currentJuz.n <= 1;
	previousJuz.onclick = () => {
		const location = nav.juz[currentJuz!.n - 2];
		if (location) actions.navigateTo(location.surah, location.ayah);
	};
	juzGroup.createSpan({ cls: "falah-reader-juz-label", text: strings.readerJuzLabel(currentJuz?.n ?? 1) });
	const nextJuz = iconButton(juzGroup, "chevron-right", strings.readerJuzNext);
	nextJuz.disabled = !currentJuz || currentJuz.n >= 30;
	nextJuz.onclick = () => {
		const location = nav.juz[currentJuz!.n];
		if (location) actions.navigateTo(location.surah, location.ayah);
	};

	const pageGroup = navBar.createDiv({
		cls: "falah-reader-toolbar-group falah-mushaf-page-navigation",
		attr: { "aria-label": strings.readerMushafPage },
	});
	const previousPage = iconButton(pageGroup, "chevron-left", strings.readerPreviousPage);
	previousPage.disabled = page <= 1;
	previousPage.onclick = () => actions.previousPage();
	const pageSelect = pageGroup.createEl("select", { cls: "dropdown falah-mushaf-page-select", attr: { "aria-label": strings.readerMushafPage } });
	for (let n = 1; n <= QCF_PAGE_COUNT; n++) pageSelect.createEl("option", { value: String(n), text: strings.readerPageLabel(n) });
	pageSelect.value = String(page);
	pageSelect.onchange = () => actions.selectPage(Number(pageSelect.value));
	const nextPage = iconButton(pageGroup, "chevron-right", strings.readerNextPage);
	nextPage.disabled = page >= QCF_PAGE_COUNT;
	nextPage.onclick = () => actions.nextPage();
	const settings = iconButton(primary, "settings", strings.readerToolbarOptions);
	settings.addClass("falah-reader-toolbar-settings");
	settings.setAttr("aria-expanded", String(options.optionsOpen));
	settings.toggleClass("is-active", options.optionsOpen);
	settings.onclick = () => actions.setOptionsOpen(!options.optionsOpen);
		const player = controls.createDiv({ cls: "falah-reader-player", attr: { role: "group", "aria-label": strings.readerAudioPlayer } });
	actions.mountAudio(player);

	if (!options.optionsOpen) return;
	const panel = controls.createDiv({ cls: "falah-reader-options-panel falah-mushaf-options-panel" });
	container.onkeydown = (event) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		actions.setOptionsOpen(false);
	};
	const arabic = panel.createDiv({ cls: "falah-reader-options-section" });
	arabic.createDiv({ cls: "falah-reader-options-heading", text: strings.readerToolbarArabicText });
	const fontGroup = arabic.createDiv({ cls: "falah-reader-toolbar-group falah-mushaf-font-options" });
	const fontSelect = fontGroup.createEl("select", { cls: "dropdown", attr: { "aria-label": strings.readerToolbarArabicText } });
	fontSelect.createEl("option", { value: "", text: `QCF4 · ${strings.readerScriptUthmani}` });
	const candidates = [
		...bundledFontsForScript("uthmani").map((font) => font.family),
		...options.vaultFontFamilies,
		options.configuredFont,
	];
	const families = dedupeFamilies(candidates.filter((family): family is string => typeof family === "string"));
	for (const family of families) fontSelect.createEl("option", { value: family, text: family });
	fontSelect.value = options.useTextFont ? (options.configuredFont ?? families[0] ?? "") : "";
	fontSelect.onchange = () => actions.selectTextFont(fontSelect.value);

	const view = panel.createDiv({ cls: "falah-reader-options-section" });
	view.createDiv({ cls: "falah-reader-options-heading", text: strings.readerToolbarView });
	const size = view.createDiv({ cls: "falah-reader-toolbar-group falah-reader-toolbar-size falah-mushaf-size" });
	iconButton(size, "minus", strings.readerDecreaseText).onclick = () => actions.changeFontSize(-2);
	size.createSpan({ cls: "falah-mushaf-size-value", text: `${options.fontSize}px` });
	iconButton(size, "plus", strings.readerIncreaseText).onclick = () => actions.changeFontSize(2);
}

export interface MushafPageOptions {
	textFont?: string;
}

function arabicVerseMarker(verseKey: string | undefined): string {
	const ayah = verseKey?.split(":")[1] ?? "";
	const digits = ayah.replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)] ?? digit);
	return `۝${digits}`;
}

export function renderMushafPage(
	container: HTMLElement,
	data: QcfPage,
	selectedVerse: string | undefined,
	wordRows: ReadonlyMap<string, WordViewModel[]>,
	actions: MushafViewActions,
	options: MushafPageOptions = {},
): void {
	container.empty();
	const stage = container.createDiv({ cls: "falah-mushaf-stage" });
	const strings = t();
	const page = stage.createDiv({ cls: "falah-mushaf-page", attr: { dir: "rtl", "aria-label": strings.readerMushafPageAria(data.page) } });
	page.toggleClass("is-opening-page", data.page <= 2);
	page.toggleClass("is-text-font", !!options.textFont);
	const folio = page.createDiv({ cls: "falah-mushaf-folio" });
	const names = folio.createSpan({ cls: "falah-mushaf-surah-names" });
	data.surahs.forEach((surah, index) => {
		if (index > 0) {
			names.createSpan({
				cls: "falah-mushaf-surah-separator",
				text: "·",
				attr: { "aria-hidden": "true" },
			});
		}
		names.createSpan({
			cls: "falah-surah-name-glyph",
			text: surahNameFontLigature(surah.id),
			attr: { dir: "ltr", role: "img", "aria-label": surah.name_arabic },
		});
	});
	folio.createSpan({ text: String(data.page) });
	const lines = page.createDiv({ cls: "falah-mushaf-lines" });
	for (const line of data.lines) {
		const row = lines.createDiv({ cls: "falah-mushaf-line" });
		row.style.gridRow = String(line.line);
		for (const word of line.words) {
			const glyph = row.createSpan({ cls: `falah-mushaf-word is-${word.type}` });
			const useTextShape = !!options.textFont && (word.type === "word" || word.type === "end");
			const shape = glyph.createSpan({
				cls: "falah-mushaf-word-glyph",
				text: useTextShape
					? (word.type === "end" ? arabicVerseMarker(word.verse_key) : (word.text ?? word.char))
					: word.char,
				attr: { "aria-hidden": "true" },
			});
			shape.style.fontFamily = useTextShape ? fontStackFor(options.textFont ?? "") : `'${word.font}'`;
			glyph.createSpan({
				cls: "falah-reader-word-sr-gloss",
				text: word.verse_key
					? strings.readerVerseGlyphAria(word.verse_key, word.text)
					: word.text,
			});
			if (!word.verse_key) continue;
			glyph.dataset.verseKey = word.verse_key;
			glyph.toggleClass("is-selected", word.verse_key === selectedVerse);
			const [surah, ayah] = word.verse_key.split(":").map(Number);
			const analysis = typeof word.position === "number"
				? wordRows.get(word.verse_key)?.find((candidate) => candidate.position === word.position)
				: undefined;
				glyph.toggleClass("has-analysis", analysis !== undefined);
				glyph.setAttr("role", "button");
				glyph.setAttr("aria-label", strings.readerVerseGlyphAria(word.verse_key, word.text));
				glyph.tabIndex = word.position === 1 ? 0 : -1;
			const select = () => {
				actions.selectVerse(surah, ayah);
				if (analysis) actions.inspectWord(analysis, glyph);
			};
			glyph.onclick = select;
			// Match Study mode: desktop right-click and the browser's mobile
			// long-press context menu both open the shared verse actions.
			glyph.oncontextmenu = (event) => {
				event.preventDefault();
				event.stopPropagation();
				actions.openVerseActions(surah, ayah, event);
			};
				glyph.onkeydown = (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						select();
					} else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
						event.preventDefault();
						const words = Array.from(page.querySelectorAll<HTMLElement>(".falah-mushaf-word[role=button]"));
						const index = words.indexOf(glyph);
						const delta = event.key === "ArrowLeft" ? 1 : -1;
						const target = words[index + delta];
						if (target) {
							glyph.tabIndex = -1;
							target.tabIndex = 0;
							target.focus();
						}
					} else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
					event.preventDefault();
					const rect = glyph.getBoundingClientRect();
					const MouseEventCtor = glyph.ownerDocument.defaultView?.MouseEvent ?? MouseEvent;
					actions.openVerseActions(surah, ayah, new MouseEventCtor("contextmenu", {
						bubbles: true,
						clientX: rect.left + rect.width / 2,
						clientY: rect.bottom,
					}));
				}
			};
		}
	}
	const footer = page.createDiv({ cls: "falah-mushaf-page-footer" });
	footer.createSpan({ text: "مُصْحَفُ الْمَدِينَةِ" });
	if (selectedVerse) {
		const [surah, ayah] = selectedVerse.split(":").map(Number);
		const selected = footer.createEl("button", { cls: "falah-mushaf-study-verse", text: strings.readerStudyAyah(selectedVerse) });
		selected.onclick = () => actions.studyVerse(surah, ayah);
	} else {
		footer.createSpan({ text: strings.readerSelectAyah });
	}
	const bottomNav = stage.createDiv({ cls: "falah-mushaf-bottom-navigation", attr: { "aria-label": strings.readerMushafPage } });
	const previous = pageNavigationButton(bottomNav, "previous", Math.max(1, data.page - 1), strings.readerPreviousPage);
	previous.disabled = data.page <= 1;
	previous.onclick = () => actions.previousPage();
	bottomNav.createSpan({ cls: "falah-mushaf-bottom-current", text: strings.readerPageLabel(data.page) });
	const next = pageNavigationButton(bottomNav, "next", Math.min(QCF_PAGE_COUNT, data.page + 1), strings.readerNextPage);
	next.disabled = data.page >= QCF_PAGE_COUNT;
	next.onclick = () => actions.nextPage();
	stage.createDiv({ cls: "falah-mushaf-attribution", text: "QCF4 · Hafs · Madinah Mushaf 1441 AH" });
}

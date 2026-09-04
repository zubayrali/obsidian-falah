import { Menu, setIcon } from "obsidian";
import type { ArabicScript, ResourceDescriptor, Surah } from "../data/schema";
import { bundledFontsForScript, dedupeFamilies } from "../fonts";
import { t } from "../i18n";
import { juzOf } from "../nav/locate";
import type { QuranNav } from "../nav/schema";
import { editionAvailableForSurah } from "../compare/model";
import type { ReaderState } from "./state";
import { readerSurahName } from "./surah-name";

let toolbarRenderId = 0;

export interface ReaderToolbarActions {
	navigateTo(surah: number, ayah?: number): void;
	selectSurah(surah: number): void;
	selectScript(script: ArabicScript): void;
	selectFont(family: string): void;
	selectTranslation(resourceId: string): void;
	selectTafsir(resourceId: string): void;
	selectComparisons(resourceIds: string[]): void;
	changeFontSize(delta: number): void;
	popOut(): void;
	setOptionsOpen(open: boolean): void;
	mountAudio(parent: HTMLElement): void;
	showReading(): void;
}

export interface ReaderToolbarOptions {
	container: HTMLElement;
	state: Readonly<ReaderState>;
	surahs: Surah[];
	resources: ResourceDescriptor[];
	nav: QuranNav;
	currentAyah: number;
	vaultFontFamilies: string[];
	configuredFont?: string;
	canPopOut: boolean;
	actions: ReaderToolbarActions;
}

function iconButton(parent: HTMLElement, icon: string, label: string, className = ""): HTMLButtonElement {
	const button = parent.createEl("button", {
		cls: `falah-reader-btn falah-icon-button ${className}`.trim(),
		attr: { "aria-label": label, title: label },
	});
	button.type = "button";
	setIcon(button, icon);
	return button;
}

/** Render the complete reader toolbar from state and a compact action interface. */
export function renderReaderToolbar(options: ReaderToolbarOptions): void {
	const { actions, container, currentAyah, nav, resources, state, surahs } = options;
	const strings = t();
	container.empty();
	container.onkeydown = null;
	container.removeClass("falah-reader-toolbar-collapsed", "falah-mushaf-toolbar");
	const controls = container.createDiv({ cls: "falah-reader-toolbar-controls" });
	const primaryRow = controls.createDiv({ cls: "falah-reader-toolbar-primary" });
	const modeSwitcher = primaryRow.createDiv({ cls: "falah-reader-mode-switch", attr: { role: "group", "aria-label": strings.readerModeLabel } });
	const readingMode = modeSwitcher.createEl("button", { text: strings.readerModeReading, attr: { "aria-pressed": "false" } });
	readingMode.type = "button";
	readingMode.onclick = () => actions.showReading();
	const studyMode = modeSwitcher.createEl("button", { cls: "is-active", text: strings.readerModeStudy, attr: { "aria-pressed": "true" } });
	studyMode.type = "button";
	const navigationRow = primaryRow.createDiv({ cls: "falah-reader-toolbar-navigation" });

	const navGroup = navigationRow.createDiv({
		cls: "falah-reader-toolbar-group falah-reader-toolbar-surah",
		attr: { "data-label": strings.readerToolbarChapter },
	});
	const previous = iconButton(navGroup, "chevron-left", strings.detailPrevious);
	previous.disabled = state.surah <= 1;
	previous.onclick = () => actions.selectSurah(state.surah - 1);
	const surahSelect = navGroup.createEl("select", { cls: "dropdown", attr: { "aria-label": strings.readerToolbarChapter } });
	const selectedTranslation = resources.find((resource) =>
		resource.type === "translation" && resource.id === state.translationId
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
	surahSelect.value = String(state.surah);
	surahSelect.onchange = () => actions.selectSurah(Number(surahSelect.value));
	const next = iconButton(navGroup, "chevron-right", strings.detailNext);
	next.disabled = state.surah >= 114;
	next.onclick = () => actions.selectSurah(state.surah + 1);

	const juzGroup = navigationRow.createDiv({
		cls: "falah-reader-toolbar-group falah-reader-toolbar-nav",
		attr: { "data-label": strings.readerToolbarPosition },
	});
	const currentJuz = juzOf(nav, state.surah, currentAyah);
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

	const optionsId = `falah-reader-options-${++toolbarRenderId}`;
	const settings = iconButton(primaryRow, "settings", strings.readerToolbarOptions, "falah-reader-toolbar-settings");
	settings.setAttr("aria-expanded", String(!!state.toolbarOptionsOpen));
	settings.setAttr("aria-controls", optionsId);
	settings.toggleClass("is-active", !!state.toolbarOptionsOpen);
	settings.onclick = () => actions.setOptionsOpen(!state.toolbarOptionsOpen);

	const player = controls.createDiv({ cls: "falah-reader-player", attr: { role: "group", "aria-label": strings.readerAudioPlayer } });
	actions.mountAudio(player);

	if (!state.toolbarOptionsOpen) return;
	const optionsPanel = controls.createDiv({
		cls: "falah-reader-options-panel",
		attr: { id: optionsId, "aria-label": strings.readerToolbarOptions },
	});
	container.onkeydown = (event) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		actions.setOptionsOpen(false);
	};

	const arabicSection = optionsPanel.createDiv({ cls: "falah-reader-options-section" });
	arabicSection.createDiv({ cls: "falah-reader-options-heading", text: strings.readerToolbarArabicText });
	const scriptFontGroup = arabicSection.createDiv({
		cls: "falah-reader-toolbar-group falah-reader-toolbar-cluster-script-font",
	});
	const scriptSelect = scriptFontGroup.createDiv({ cls: "falah-reader-toolbar-script" }).createEl("select", { cls: "dropdown", attr: { "aria-label": strings.setArabicScriptName } });
	scriptSelect.createEl("option", { value: "uthmani", text: strings.readerScriptUthmani });
	scriptSelect.createEl("option", { value: "indopak", text: strings.readerScriptIndopak });
	scriptSelect.value = state.script;
	scriptSelect.onchange = () => actions.selectScript(scriptSelect.value);

	const fontSelect = scriptFontGroup.createDiv({ cls: "falah-reader-toolbar-font" }).createEl("select", { cls: "dropdown", attr: { "aria-label": strings.setUthmaniFontName } });
	const fontCandidates = [
		...bundledFontsForScript(state.script).map((font) => font.family),
		...options.vaultFontFamilies,
		options.configuredFont,
	];
	const fontFamilies = dedupeFamilies(fontCandidates.filter((family): family is string => typeof family === "string"));
	for (const family of fontFamilies) fontSelect.createEl("option", { value: family, text: family });
	fontSelect.value = options.configuredFont ?? "";
	fontSelect.onchange = () => actions.selectFont(fontSelect.value);

	const readingSection = optionsPanel.createDiv({ cls: "falah-reader-options-section" });
	readingSection.createDiv({ cls: "falah-reader-options-heading", text: strings.readerToolbarReading });
	const editions = readingSection.createDiv({
		cls: "falah-reader-toolbar-group falah-reader-toolbar-editions",
	});
	const translation = editions.createEl("select", { cls: "dropdown", attr: { "aria-label": strings.setPreferredTranslationName } });
	translation.createEl("option", { value: "", text: strings.readerNoTranslation });
	for (const resource of resources.filter((item) => item.type === "translation")) {
		translation.createEl("option", {
			value: resource.id,
			text: resource.tier === "bundled" ? strings.readerResourceDefault(resource.name) : resource.name,
		});
	}
	translation.value = state.translationId;
	translation.onchange = () => actions.selectTranslation(translation.value);

	const tafsir = editions.createDiv({ cls: "falah-reader-toolbar-tafsir" }).createEl("select", { cls: "dropdown", attr: { "aria-label": strings.setPreferredTafsirName } });
	tafsir.createEl("option", { value: "", text: strings.readerNoTafsir });
	for (const resource of resources.filter((item) => item.type === "tafsir")) {
		tafsir.createEl("option", { value: resource.id, text: resource.name });
	}
	tafsir.value = state.tafsirId;
	tafsir.onchange = () => actions.selectTafsir(tafsir.value);

	let selectedComparisons = [...state.compareIds];
	const compare = editions.createEl("button", {
		cls: "falah-reader-btn falah-reader-compare",
		attr: { "aria-label": strings.readerCompareLabel, title: strings.readerCompareLabel },
	});
	compare.type = "button";
	const syncCompareButton = () => {
		compare.empty();
		setIcon(compare, "columns-3");
		compare.createSpan({
			cls: "falah-reader-compare-label",
			text: selectedComparisons.length ? `${strings.readerCompareButton} (${selectedComparisons.length})` : strings.readerCompareButton,
		});
		compare.toggleClass("is-active", selectedComparisons.length > 0);
	};
	syncCompareButton();
	compare.onclick = (event) => {
		const menu = new Menu();
		for (const resource of resources.filter((item) => item.type === "translation" || item.type === "tafsir")) {
			const selected = selectedComparisons.includes(resource.id);
			const available = editionAvailableForSurah(resource, state.surah);
			menu.addItem((item) => item
				.setTitle(available ? resource.name : `${resource.name} · ${strings.readerCompareUnavailableForSurah}`)
				.setSection(resource.type === "translation" ? "translations" : "tafsirs")
				.setChecked(selected)
				.setDisabled(!selected && (!available || selectedComparisons.length >= 4))
				.onClick(() => {
					selectedComparisons = selected
						? selectedComparisons.filter((id) => id !== resource.id)
						: [...selectedComparisons, resource.id].slice(0, 4);
					actions.selectComparisons(selectedComparisons);
					syncCompareButton();
				}));
		}
		menu.showAtMouseEvent(event);
	};

	const viewSection = optionsPanel.createDiv({ cls: "falah-reader-options-section" });
	viewSection.createDiv({ cls: "falah-reader-options-heading", text: strings.readerToolbarView });
	const size = viewSection.createDiv({
		cls: "falah-reader-toolbar-group falah-reader-toolbar-cluster-size",
	})
		.createDiv({ cls: "falah-reader-toolbar-size" });
	iconButton(size, "minus", strings.readerDecreaseText).onclick = () => actions.changeFontSize(-2);
	iconButton(size, "plus", strings.readerIncreaseText).onclick = () => actions.changeFontSize(2);

	const end = viewSection.createDiv({ cls: "falah-reader-toolbar-group falah-reader-toolbar-window-actions" });
	if (options.canPopOut) {
		const popOut = iconButton(end.createDiv({ cls: "falah-reader-toolbar-popout" }), "panel-top-open", strings.readerPopOutAriaLabel);
		popOut.onclick = () => actions.popOut();
	}
}

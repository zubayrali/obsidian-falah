import { Setting } from "obsidian";
import type FalahPlugin from "../main";
import type { ArabicScript, ResourceDescriptor } from "../data/schema";
import { t } from "../i18n";
import { logMessage } from "../log";
import { bundledFontsForScript, fontStackFor, groupSystemFonts } from "../fonts";
import { RECITERS } from "../audio/recitation";
import { closeWordInspector } from "../word-by-word/inspector";
import { createSettingsPageIntro, createSettingsSection } from "./ui";

export function renderDisplayZone(
	plugin: FalahPlugin,
	containerEl: HTMLElement,
	resources: ResourceDescriptor[],
	rerender: () => Promise<void>,
): void {
	createSettingsPageIntro(containerEl, t().setReaderPageTitle, t().setReaderPageDesc);
	const defaults = createSettingsSection(containerEl, {
		id: "reader-defaults",
		title: t().setReaderDefaultsHeading,
		description: t().setReaderDefaultsDesc,
		icon: "book-open-text",
	});

	new Setting(defaults).setName(t().setReciterName).setDesc(t().setReciterDesc).addDropdown((dropdown) => {
		for (const reciter of RECITERS) dropdown.addOption(reciter.id, reciter.name);
		dropdown.setValue(plugin.settings.reciterId).onChange(async (id) => {
			const reciter = RECITERS.find((item) => item.id === id);
			if (!reciter) return;
			plugin.settings.reciterId = id;
			await plugin.persist();
			await plugin.recitation.dispatch({ type: "set-reciter", reciter });
		});
	});
	new Setting(defaults).setName(t().setArabicScriptName).setDesc(t().setArabicScriptDesc).addDropdown((dropdown) =>
		dropdown.addOption("uthmani", t().libraryScriptUthmaniOption)
			.addOption("indopak", t().libraryScriptIndopakOption)
			.setValue(plugin.settings.arabicScript)
			.onChange(async (value) => {
				plugin.settings.arabicScript = value;
				await plugin.persist();
			}));

	const label = (resource: ResourceDescriptor) => resource.tier === "bundled"
		? t().libraryResourceDefault(resource.name)
		: resource.name;
	new Setting(defaults).setName(t().setPreferredTranslationName).setDesc(t().setPreferredTranslationDesc).addDropdown((dropdown) => {
		dropdown.addOption("", t().libraryNoneOption);
		for (const resource of resources.filter((item) => item.type === "translation")) dropdown.addOption(resource.id, label(resource));
		dropdown.setValue(plugin.settings.translationResourceId).onChange(async (value) => {
			plugin.settings.translationResourceId = value;
			await plugin.persist();
		});
	});
	new Setting(defaults).setName(t().setPreferredTafsirName).setDesc(t().setPreferredTafsirDesc).addDropdown((dropdown) => {
		dropdown.addOption("", t().libraryNoneOption);
		for (const resource of resources.filter((item) => item.type === "tafsir")) dropdown.addOption(resource.id, label(resource));
		dropdown.setValue(plugin.settings.tafsirResourceId).onChange(async (value) => {
			plugin.settings.tafsirResourceId = value;
			await plugin.persist();
		});
	});

	const wordAnalysis = createSettingsSection(containerEl, {
		id: "reader-word-analysis",
		title: t().setHeadingWordAnalysis,
		description: t().setWordAnalysisSectionDesc,
		icon: "languages",
	});
	new Setting(wordAnalysis).setName(t().setWordAnalysisEnabledName).setDesc(t().setWordAnalysisEnabledDesc).addToggle((toggle) =>
		toggle.setValue(plugin.settings.wordAnalysisEnabled).onChange(async (value) => {
			plugin.settings.wordAnalysisEnabled = value;
			if (!value) closeWordInspector(document);
			await plugin.persist();
			plugin.refreshReader();
			await rerender();
		}));
	if (plugin.settings.wordAnalysisEnabled) {
		new Setting(wordAnalysis).setName(t().setWordResourceName).setDesc(t().setWordResourceDesc).addDropdown((dropdown) => {
			dropdown.addOption("", t().libraryNoneOption);
			for (const resource of resources.filter((item) => item.cardinality === "per-word")) dropdown.addOption(resource.id, resource.name);
			dropdown.setValue(plugin.settings.wordResourceId).onChange(async (id) => {
				plugin.settings.wordResourceId = id;
				await plugin.persist();
				plugin.refreshReader();
			});
		});
		new Setting(wordAnalysis).setName(t().setWordTranslationName).addToggle((toggle) =>
			toggle.setValue(plugin.settings.wordShowTranslation).onChange(async (value) => {
				plugin.settings.wordShowTranslation = value;
				await plugin.persist();
				plugin.refreshReaderRows();
			}));
		new Setting(wordAnalysis).setName(t().setWordTransliterationName).addToggle((toggle) =>
			toggle.setValue(plugin.settings.wordShowTransliteration).onChange(async (value) => {
				plugin.settings.wordShowTransliteration = value;
				await plugin.persist();
				plugin.refreshReaderRows();
			}));
		new Setting(wordAnalysis).setName(t().setWordInspectorGlassName).setDesc(t().setWordInspectorGlassDesc).addToggle((toggle) =>
			toggle.setValue(plugin.settings.wordInspectorGlass).onChange(async (value) => {
				plugin.settings.wordInspectorGlass = value;
				closeWordInspector(document);
				await plugin.persist();
			}));
		new Setting(wordAnalysis).setName(t().setWordInspectorDraggableName).setDesc(t().setWordInspectorDraggableDesc).addToggle((toggle) =>
			toggle.setValue(plugin.settings.wordInspectorDraggable).onChange(async (value) => {
				plugin.settings.wordInspectorDraggable = value;
				closeWordInspector(document);
				await plugin.persist();
			}));
		new Setting(wordAnalysis).setName(t().setWordInspectorDictionaryName).setDesc(t().setWordInspectorDictionaryDesc).addToggle((toggle) =>
			toggle.setValue(plugin.settings.wordInspectorShowDictionary).onChange(async (value) => {
				plugin.settings.wordInspectorShowDictionary = value;
				closeWordInspector(document);
				await plugin.persist();
			}));
		new Setting(wordAnalysis).setName(t().setWordInspectorGrammarName).setDesc(t().setWordInspectorGrammarDesc).addToggle((toggle) =>
			toggle.setValue(plugin.settings.wordInspectorShowGrammar).onChange(async (value) => {
				plugin.settings.wordInspectorShowGrammar = value;
				closeWordInspector(document);
				await plugin.persist();
			}));
	}

	const typography = createSettingsSection(containerEl, {
		id: "reader-typography",
		title: t().setTypographyHeading,
		description: t().setTypographyDesc,
		icon: "type",
	});
	for (const script of ["uthmani", "indopak"] as ArabicScript[]) {
		const name = script === "uthmani" ? t().setUthmaniFontName : t().setIndopakFontName;
		const setting = new Setting(typography).setName(name).setDesc(t().setScriptFontDesc);
		setting.settingEl.addClass("falah-font-setting");
		const picker = setting.controlEl.createDiv({ cls: "falah-font-picker" });
		const current = plugin.settings.fontByScript[script];
		const select = picker.createEl("select", {
			cls: "dropdown falah-font-select",
			attr: { "aria-label": name },
		});
		const used = new Set<string>();
		const addGroup = (label: string, families: string[]) => {
			const available = families.filter((family) => family && !used.has(family));
			if (!available.length) return;
			const group = select.createEl("optgroup");
			group.label = label;
			for (const family of available) {
				used.add(family);
				group.createEl("option", { value: family, text: family });
			}
		};
		addGroup(t().libraryFontSourceBundled, bundledFontsForScript(script).map((font) => font.family));
		addGroup(t().libraryFontSourceVault, plugin.fonts.vaultFamilies());
		const systemFonts = groupSystemFonts(plugin.fonts.systemFamilies());
		addGroup(t().libraryFontSourceSystemArabic, systemFonts.arabic);
		addGroup(t().libraryFontSourceSystemOther, systemFonts.other);
		if (current && !used.has(current)) addGroup(t().libraryFontSourceCustom, [current]);
		select.createEl("option", { value: "__custom_font__", text: t().libraryCustomFontOption });
		select.value = current;

		const customRow = picker.createDiv({ cls: "falah-font-custom is-hidden" });
		const customInput = customRow.createEl("input", {
			type: "text",
			attr: {
				placeholder: t().libraryCustomFontPlaceholder,
				"aria-label": t().libraryCustomFontOption,
			},
		});
		const preview = picker.createDiv({ cls: "falah-font-preview" });
		preview.createSpan({ cls: "falah-font-preview-label", text: t().libraryFontPreviewLabel });
		const sample = preview.createSpan({
			cls: "falah-font-preview-sample",
			text: "بِسْمِ ٱللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
		});
		const updatePreview = (family: string) => { sample.style.fontFamily = fontStackFor(family); };
		const saveFamily = async (family: string) => {
			plugin.settings.fontByScript[script] = family;
			await plugin.persist();
			plugin.refreshReader();
		};
		updatePreview(current);
		select.addEventListener("change", () => {
			if (select.value === "__custom_font__") {
				select.value = plugin.settings.fontByScript[script];
				customRow.removeClass("is-hidden");
				customInput.focus();
				return;
			}
			customRow.addClass("is-hidden");
			updatePreview(select.value);
			void saveFamily(select.value);
		});
		customInput.addEventListener("input", () => updatePreview(customInput.value.trim()));
		customInput.addEventListener("change", () => {
			const family = customInput.value.trim();
			if (!family) {
				customRow.addClass("is-hidden");
				updatePreview(plugin.settings.fontByScript[script]);
				return;
			}
			void saveFamily(family).then(() => rerender());
		});
	}
	new Setting(typography).setName(t().setFontSourcesName).setDesc(
		`${t().setFontSourcesDesc(plugin.manifest.dir ?? "")} ${t().libraryFontSourcesStatus(
			plugin.fonts.vaultFamilies().length,
			plugin.fonts.systemFamilies().length,
		)}`,
	)
		.addButton((button) => button.setButtonText(t().libraryDetectFontsButton).onClick(async () => {
			try {
				button.setDisabled(true);
				const families = await plugin.fonts.detectSystemFonts();
				if (!families.length) {
					logMessage(t().noticeFontDetectionUnavailable, "warn");
					button.setDisabled(false);
					return;
				}
				logMessage(t().noticeFontsDetected(families.length), "info");
				await rerender();
			} catch {
				button.setDisabled(false);
				logMessage(t().noticeFontAccessDenied, "warn");
			}
		}))
		.addButton((button) => button.setButtonText(t().libraryReloadFontsButton).onClick(async () => {
			await plugin.fonts.reload();
			logMessage(t().noticeFontsReloaded, "info");
			plugin.refreshReader();
			await rerender();
		}));
}

export function renderReaderZone(plugin: FalahPlugin, containerEl: HTMLElement, rerender: () => Promise<void>): void {
	const appearance = createSettingsSection(containerEl, {
		id: "reader-appearance",
		title: t().setReaderAppearanceHeading,
		description: t().setReaderAppearanceDesc,
		icon: "palette",
	});
	new Setting(appearance).setName(t().setReaderMaxWidthName).setDesc(t().setReaderMaxWidthDesc).addSlider((slider) =>
		slider.setLimits(480, 1200, 20).setValue(plugin.settings.readerMaxWidth).setDynamicTooltip().onChange(async (value) => {
			plugin.settings.readerMaxWidth = value;
			await plugin.persist();
			plugin.applyReaderTheme();
		}));
	const themedColor = (name: string, desc: string, key: "readerAyahNumColor" | "readerTafsirColor", themeVar: string) => {
		new Setting(appearance).setName(name).setDesc(desc).addColorPicker((picker) => {
			const current = plugin.settings[key] || getComputedStyle(document.body).getPropertyValue(themeVar).trim();
			picker.setValue(current).onChange(async (value) => {
				plugin.settings[key] = value;
				await plugin.persist();
				plugin.applyReaderTheme();
			});
		}).addExtraButton((button) => button.setIcon("rotate-ccw").setTooltip(t().setReaderResetColorTooltip).onClick(async () => {
			plugin.settings[key] = "";
			await plugin.persist();
			plugin.applyReaderTheme();
			await rerender();
		}));
	};
	themedColor(t().setReaderAyahColorName, t().setReaderAyahColorDesc, "readerAyahNumColor", "--text-accent");
	themedColor(t().setReaderTafsirColorName, t().setReaderTafsirColorDesc, "readerTafsirColor", "--text-muted");
	new Setting(appearance).setName(t().setReaderBismillahSizeName).setDesc(t().setReaderBismillahSizeDesc).addSlider((slider) =>
		slider.setLimits(1, 2.4, 0.1).setValue(plugin.settings.readerBismillahSize).setDynamicTooltip().onChange(async (value) => {
			plugin.settings.readerBismillahSize = value;
			await plugin.persist();
			plugin.applyReaderTheme();
		}));
	new Setting(appearance).setName(t().setReaderTitleSizeName).setDesc(t().setReaderTitleSizeDesc).addSlider((slider) =>
		slider.setLimits(1, 2, 0.1).setValue(plugin.settings.readerTitleSize).setDynamicTooltip().onChange(async (value) => {
			plugin.settings.readerTitleSize = value;
			await plugin.persist();
			plugin.applyReaderTheme();
		}));

	const toolbar = createSettingsSection(containerEl, {
		id: "reader-toolbar",
		title: t().setReaderToolbarHeading,
		description: t().setReaderToolbarDesc,
		icon: "panel-top",
	});
	type HideKey = "readerHideScriptPicker" | "readerHideFontPicker" | "readerHideTafsirPicker" | "readerHideSizeButtons" | "readerHidePopout" | "readerHideNav";
	const showToggle = (name: string, desc: string, key: HideKey) => {
		new Setting(toolbar).setName(name).setDesc(desc).addToggle((toggle) => toggle.setValue(!plugin.settings[key]).onChange(async (value) => {
			plugin.settings[key] = !value;
			await plugin.persist();
			plugin.applyReaderTheme();
		}));
	};
	showToggle(t().setReaderHideScriptPickerName, t().setReaderHideScriptPickerDesc, "readerHideScriptPicker");
	showToggle(t().setReaderHideFontPickerName, t().setReaderHideFontPickerDesc, "readerHideFontPicker");
	showToggle(t().setReaderHideTafsirPickerName, t().setReaderHideTafsirPickerDesc, "readerHideTafsirPicker");
	showToggle(t().setReaderHideSizeButtonsName, t().setReaderHideSizeButtonsDesc, "readerHideSizeButtons");
	showToggle(t().setReaderHidePopoutName, t().setReaderHidePopoutDesc, "readerHidePopout");
	showToggle(t().setReaderHideNavName, t().setReaderHideNavDesc, "readerHideNav");
}

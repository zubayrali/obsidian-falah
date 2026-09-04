import type { FalahSettings } from "../settings";

/** Apply the reader's CSS variables and visibility classes to a document body. */
export function applyReaderTheme(settings: FalahSettings, body: HTMLElement = document.body): void {
	const setVar = (name: string, value: string) => body.style.setProperty(name, value);
	const clearVar = (name: string) => body.style.removeProperty(name);

	setVar("--falah-reader-max-width", `${settings.readerMaxWidth}px`);
	if (settings.readerAyahNumColor) setVar("--falah-reader-ayah-num-color", settings.readerAyahNumColor);
	else clearVar("--falah-reader-ayah-num-color");
	if (settings.readerTafsirColor) setVar("--falah-reader-tafsir-color", settings.readerTafsirColor);
	else clearVar("--falah-reader-tafsir-color");
	setVar("--falah-reader-bismillah-size", `${settings.readerBismillahSize}em`);
	setVar("--falah-reader-title-size", `${settings.readerTitleSize}em`);

	body.toggleClass("falah-hide-script-picker", settings.readerHideScriptPicker);
	body.toggleClass("falah-hide-font-picker", settings.readerHideFontPicker);
	body.toggleClass("falah-hide-tafsir-picker", settings.readerHideTafsirPicker);
	body.toggleClass("falah-hide-size-buttons", settings.readerHideSizeButtons);
	body.toggleClass("falah-hide-popout", settings.readerHidePopout);
	body.toggleClass("falah-hide-nav", settings.readerHideNav);
}

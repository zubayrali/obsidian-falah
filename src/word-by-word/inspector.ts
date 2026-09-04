import { App, Modal, setIcon } from "obsidian";
import { t } from "../i18n";
import type { MorphologySegment, WordMorphology } from "../data/schema";
import { arabicWordForDisplay, morphologyTransliterationForDisplay } from "./display";
import type { WordViewModel } from "./model";

export interface WordInspectorOptions {
	glass: boolean;
	draggable: boolean;
	showDictionary: boolean;
	showGrammar: boolean;
}

const DEFAULT_INSPECTOR_OPTIONS: WordInspectorOptions = {
	glass: true,
	draggable: true,
	showDictionary: true,
	showGrammar: true,
};

const GRAMMAR_FIELDS: Array<[keyof WordMorphology, () => string]> = [
	["root", () => t().wordInspectorRoot],
	["lemma", () => t().wordInspectorLemma],
	["partOfSpeech", () => t().wordInspectorPartOfSpeech],
	["case", () => t().wordInspectorCase],
	["gender", () => t().wordInspectorGender],
	["number", () => t().wordInspectorNumber],
	["person", () => t().wordInspectorPerson],
	["voice", () => t().wordInspectorVoice],
	["mood", () => t().wordInspectorMood],
	["aspect", () => t().wordInspectorAspect],
];

function renderMeaning(body: HTMLElement, word: WordViewModel, showDictionary: boolean): void {
	const section = body.createEl("section", { cls: "falah-word-inspector-section falah-word-meaning-section" });
	section.createEl("h3", { text: t().wordInspectorMeaning });
	if (word.gloss) {
		const meaning = section.createDiv({ cls: "falah-word-inspector-meaning" });
		meaning.createDiv({ cls: "falah-word-inspector-label", text: t().wordInspectorContextualMeaning });
		meaning.createDiv({ cls: "falah-word-inspector-gloss", text: word.gloss });
	}
	if (!showDictionary) return;
	const dictionary = section.createDiv({ cls: "falah-word-inspector-dictionary" });
	dictionary.createDiv({ cls: "falah-word-inspector-label", text: t().wordInspectorDictionary });
	const senses = word.dictionary?.senses ?? [];
	if (senses.length) {
		const list = dictionary.createEl("ul");
		for (const sense of senses) list.createEl("li", { text: sense });
	} else {
		dictionary.createDiv({ cls: "falah-word-inspector-empty", text: t().wordInspectorDictionaryEmpty });
	}
	if (word.dictionary?.source) {
		dictionary.createDiv({ cls: "falah-word-inspector-source", text: t().wordInspectorSource(word.dictionary.source) });
	}
}

function renderSegment(container: HTMLElement, segment: MorphologySegment): void {
	const card = container.createDiv({ cls: `falah-word-segment is-${segment.type}` });
	card.dataset.pos = segment.partOfSpeechCode.toLowerCase();
	card.createDiv({ cls: "falah-word-segment-form", text: arabicWordForDisplay(segment.form), attr: { dir: "rtl" } });
	card.createDiv({ cls: "falah-word-segment-pos", text: segment.partOfSpeech });
	card.createDiv({ cls: "falah-word-segment-code", text: morphologyTransliterationForDisplay(segment.transliteration), attr: { dir: "ltr" } });
}

function renderGrammar(body: HTMLElement, word: WordViewModel): void {
	const section = body.createEl("section", { cls: "falah-word-inspector-section falah-word-grammar-section" });
	section.createEl("h3", { text: t().wordInspectorGrammar });
	const morphology = word.morphology;
	if (!morphology) {
		section.createDiv({ cls: "falah-word-inspector-empty", text: t().wordInspectorNoGrammar });
		return;
	}
	if (morphology.segments.length) {
		section.createDiv({ cls: "falah-word-inspector-label", text: t().wordInspectorStructure });
		const segments = section.createDiv({ cls: "falah-word-segments", attr: { dir: "rtl" } });
		for (const segment of morphology.segments) renderSegment(segments, segment);
	}
	const facts = section.createEl("dl", { cls: "falah-word-grammar-facts" });
	for (const [field, label] of GRAMMAR_FIELDS) {
		const value = morphology[field];
		if (typeof value !== "string" || !value) continue;
		facts.createEl("dt", { text: label() });
		facts.createEl("dd", {
			text: value,
			cls: field === "root" || field === "lemma" ? "falah-word-grammar-arabic" : undefined,
			attr: field === "root" || field === "lemma" ? { dir: "rtl" } : undefined,
		});
	}
}

function renderWordInspector(
	container: HTMLElement,
	word: WordViewModel,
	options: WordInspectorOptions,
	close?: () => void,
): void {
	container.addClass("falah-word-inspector");
	container.empty();
	const header = container.createDiv({ cls: "falah-word-inspector-head" });
	const identity = header.createDiv({ cls: "falah-word-inspector-identity" });
	identity.createDiv({ cls: "falah-word-inspector-arabic", text: arabicWordForDisplay(word.arabic), attr: { dir: "rtl", lang: "ar" } });
	identity.createDiv({ cls: "falah-word-inspector-coordinate", text: word.key });
	if (word.transliteration) identity.createDiv({ cls: "falah-word-inspector-transliteration", text: word.transliteration });
	if (close) {
		const closeButton = header.createEl("button", { cls: "falah-word-inspector-close", attr: { "aria-label": t().wordInspectorClose } });
		setIcon(closeButton, "x");
		closeButton.onclick = close;
	}
	const body = container.createDiv({ cls: "falah-word-inspector-body" });
	renderMeaning(body, word, options.showDictionary);
	if (options.showGrammar) renderGrammar(body, word);
}

export class WordInspectorModal extends Modal {
	constructor(app: App, private readonly word: WordViewModel, private readonly options = DEFAULT_INSPECTOR_OPTIONS) { super(app); }
	onOpen(): void {
		this.modalEl.addClass("falah-word-inspector-modal");
		this.modalEl.toggleClass("is-solid", !this.options.glass);
		renderWordInspector(this.contentEl, this.word, this.options);
	}
}

let closeActivePopover: (() => void) | undefined;

interface PopoverDragCleanup {
	cancel: () => void;
}

function makePopoverDraggable(popover: HTMLElement, win: Window): PopoverDragCleanup {
	const header = popover.querySelector<HTMLElement>(".falah-word-inspector-head");
	if (!header) return { cancel: () => undefined };
	const doc = popover.ownerDocument;

	let activePointer: number | "mouse" | undefined;
	let originX = 0;
	let originY = 0;
	let originLeft = 0;
	let originTop = 0;

	const finishDrag = () => {
		if (activePointer === undefined) return;
		if (typeof activePointer === "number" && header.hasPointerCapture(activePointer)) header.releasePointerCapture(activePointer);
		activePointer = undefined;
		popover.removeClass("is-dragging");
	};
	const movePopover = (clientX: number, clientY: number) => {
		const rect = popover.getBoundingClientRect();
		const left = Math.max(8, Math.min(win.innerWidth - rect.width - 8, originLeft + clientX - originX));
		const top = Math.max(8, Math.min(win.innerHeight - rect.height - 8, originTop + clientY - originY));
		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
		popover.removeClass("is-above");
	};
	const beginDrag = (clientX: number, clientY: number) => {
		const rect = popover.getBoundingClientRect();
		originX = clientX;
		originY = clientY;
		originLeft = rect.left;
		originTop = rect.top;
		popover.addClass("is-dragging");
	};
	const startDrag = (event: PointerEvent) => {
		if (event.button !== 0 || event.pointerType === "touch" || win.innerWidth <= 600) return;
		if ((event.target as Element | null)?.closest("button, a, input, select, textarea")) return;
		activePointer = event.pointerId;
		beginDrag(event.clientX, event.clientY);
		header.setPointerCapture(event.pointerId);
		event.preventDefault();
	};
	const moveDrag = (event: PointerEvent) => {
		if (event.pointerId === activePointer) movePopover(event.clientX, event.clientY);
	};
	const startMouseDrag = (event: MouseEvent) => {
		if (activePointer !== undefined || event.button !== 0 || win.innerWidth <= 600) return;
		if ((event.target as Element | null)?.closest("button, a, input, select, textarea")) return;
		activePointer = "mouse";
		beginDrag(event.clientX, event.clientY);
		event.preventDefault();
	};
	const moveMouseDrag = (event: MouseEvent) => {
		if (activePointer === "mouse") movePopover(event.clientX, event.clientY);
	};
	const finishMouseDrag = () => { if (activePointer === "mouse") finishDrag(); };

	header.addEventListener("pointerdown", startDrag);
	header.addEventListener("pointermove", moveDrag);
	header.addEventListener("pointerup", finishDrag);
	header.addEventListener("pointercancel", finishDrag);
	header.addEventListener("mousedown", startMouseDrag);
	doc.addEventListener("mousemove", moveMouseDrag);
	doc.addEventListener("mouseup", finishMouseDrag);
	return {
		cancel: () => {
			finishDrag();
			header.removeEventListener("pointerdown", startDrag);
			header.removeEventListener("pointermove", moveDrag);
			header.removeEventListener("pointerup", finishDrag);
			header.removeEventListener("pointercancel", finishDrag);
			header.removeEventListener("mousedown", startMouseDrag);
			doc.removeEventListener("mousemove", moveMouseDrag);
			doc.removeEventListener("mouseup", finishMouseDrag);
		},
	};
}

export function closeWordInspector(doc?: Document): void {
	closeActivePopover?.();
	doc?.querySelectorAll(".falah-word-popover").forEach((element) => element.remove());
}

function openAnchoredInspector(word: WordViewModel, anchor: HTMLElement, options: WordInspectorOptions): void {
	closeActivePopover?.();
	const doc = anchor.ownerDocument;
	const win = doc.defaultView;
	if (!win) return;
	const popover = doc.body.createDiv({ cls: "falah-word-popover", attr: { role: "dialog", "aria-label": t().wordInspectorTitle } });
	popover.toggleClass("is-solid", !options.glass);
	popover.toggleClass("is-fixed", !options.draggable);
	anchor.addClass("is-active");
	let closed = false;
	let dragCleanup: PopoverDragCleanup | undefined;
	const close = () => {
		if (closed) return;
		closed = true;
		dragCleanup?.cancel();
		popover.remove();
		anchor.removeClass("is-active");
		doc.removeEventListener("pointerdown", dismissOutside, true);
		doc.removeEventListener("keydown", dismissKey, true);
		win.removeEventListener("resize", close);
		win.removeEventListener("scroll", dismissReaderScroll, true);
		if (closeActivePopover === close) closeActivePopover = undefined;
	};
	const dismissOutside = (event: PointerEvent) => {
		const target = event.target;
		if (target && !popover.contains(target as Node) && !anchor.contains(target as Node)) close();
	};
	const dismissKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
	const dismissReaderScroll = (event: Event) => {
		const target = event.target;
		if (target && popover.contains(target as Node)) return;
		close();
	};
	renderWordInspector(popover, word, options, close);

	const anchorRect = anchor.getBoundingClientRect();
	const width = Math.min(430, win.innerWidth - 24);
	popover.style.width = `${width}px`;
	const measuredHeight = Math.min(popover.scrollHeight, win.innerHeight - 24);
	const below = anchorRect.bottom + 12;
	const top = below + measuredHeight <= win.innerHeight - 12 ? below : Math.max(12, anchorRect.top - measuredHeight - 12);
	const left = Math.max(12, Math.min(win.innerWidth - width - 12, anchorRect.left + anchorRect.width / 2 - width / 2));
	popover.style.top = `${top}px`;
	popover.style.left = `${left}px`;
	popover.toggleClass("is-above", top < anchorRect.top);
	if (options.draggable) dragCleanup = makePopoverDraggable(popover, win);

	doc.addEventListener("pointerdown", dismissOutside, true);
	doc.addEventListener("keydown", dismissKey, true);
	win.addEventListener("resize", close);
	win.addEventListener("scroll", dismissReaderScroll, true);
	closeActivePopover = close;
	popover.querySelector<HTMLElement>(".falah-word-inspector-close")?.focus();
}

export function openWordInspector(
	app: App,
	word: WordViewModel,
	anchor?: HTMLElement,
	options: WordInspectorOptions = DEFAULT_INSPECTOR_OPTIONS,
): void {
	if (anchor) openAnchoredInspector(word, anchor, options);
	else new WordInspectorModal(app, word, options).open();
}

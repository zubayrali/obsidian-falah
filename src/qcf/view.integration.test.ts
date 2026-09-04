// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { QcfPage } from "./schema";
import { renderMushafPage, type MushafViewActions } from "./view";
import type { WordViewModel } from "../word-by-word/model";

type CreateOptions = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
	value?: string;
};

function applyOptions(element: HTMLElement, options: CreateOptions = {}): void {
	if (options.cls) element.className = options.cls;
	if (options.text !== undefined) element.textContent = options.text;
	if (options.value !== undefined && element instanceof HTMLOptionElement) element.value = options.value;
	for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
}

beforeAll(() => {
	HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		options?: CreateOptions,
	): HTMLElementTagNameMap[K] {
		const child = this.ownerDocument.createElement(tag);
		applyOptions(child, options);
		this.appendChild(child);
		return child;
	};
	HTMLElement.prototype.createDiv = function (options?: CreateOptions): HTMLDivElement {
		return this.createEl("div", options);
	};
	HTMLElement.prototype.createSpan = function (options?: CreateOptions): HTMLSpanElement {
		return this.createEl("span", options);
	};
	HTMLElement.prototype.empty = function (): void { this.replaceChildren(); };
	HTMLElement.prototype.addClass = function (...classes: string[]): void { this.classList.add(...classes); };
	HTMLElement.prototype.removeClass = function (...classes: string[]): void { this.classList.remove(...classes); };
	HTMLElement.prototype.toggleClass = function (name: string, value?: boolean): void {
		this.classList.toggle(name, value);
	};
	HTMLElement.prototype.setAttr = function (name: string, value: string): void {
		this.setAttribute(name, value);
	};
});

function actions(): MushafViewActions {
	return {
		navigateTo: vi.fn(),
		selectSurah: vi.fn(),
		previousPage: vi.fn(),
		nextPage: vi.fn(),
		selectPage: vi.fn(),
		selectVerse: vi.fn(),
		openVerseActions: vi.fn(),
		studyVerse: vi.fn(),
		inspectWord: vi.fn(),
		showStudy: vi.fn(),
		setOptionsOpen: vi.fn(),
		changeFontSize: vi.fn(),
		selectTextFont: vi.fn(),
		mountAudio: vi.fn(),
	};
}

const page: QcfPage = {
	page: 42,
	font: "QCF4_Hafs_01",
	surahs: [{ id: 2, name: "Al-Baqarah", name_arabic: "البقرة", verse_start: 1, verse_end: 2 }],
	lines: [{
		line: 1,
		words: [
			{ code: 1, char: "a", font: "QCF4_Hafs_01", text: "الم", type: "word", verse_key: "2:1", position: 1 },
			{ code: 2, char: "b", font: "QCF4_Hafs_01", text: "ذلك", type: "word", verse_key: "2:2", position: 1 },
			{ code: 3, char: "c", font: "QCF4_Hafs_01", text: "الكتاب", type: "word", verse_key: "2:2", position: 2 },
		],
	}],
};

const analysis: WordViewModel = {
	key: "2:2:2",
	position: 2,
	arabic: "الكتاب",
	gloss: "the Book",
	hasSecondaryText: true,
};

describe("Mushaf rendered interaction", () => {
	it("supports click, keyboard word traversal, verse actions, and page navigation", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const callbacks = actions();
		const selectVerse = vi.fn();
		const inspectWord = vi.fn();
		const openVerseActions = vi.fn();
		const nextPage = vi.fn();
		callbacks.selectVerse = selectVerse;
		callbacks.inspectWord = inspectWord;
		callbacks.openVerseActions = openVerseActions;
		callbacks.nextPage = nextPage;
		renderMushafPage(container, page, "2:1", new Map([["2:2", [analysis]]]), callbacks);

		const words = Array.from(container.querySelectorAll<HTMLElement>(".falah-mushaf-word[role=button]"));
		expect(words).toHaveLength(3);
		expect(words.map((word) => word.tabIndex)).toEqual([0, 0, -1]);
		expect(words[2].getAttribute("aria-label")).toContain("Verse 2:2, الكتاب");

		words[1].focus();
		words[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		expect(document.activeElement).toBe(words[2]);
		expect(words[1].tabIndex).toBe(-1);
		expect(words[2].tabIndex).toBe(0);

		words[2].click();
		expect(selectVerse).toHaveBeenCalledWith(2, 2);
		expect(inspectWord).toHaveBeenCalledWith(analysis, words[2]);

		words[2].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		expect(openVerseActions).toHaveBeenCalledWith(2, 2, expect.any(MouseEvent));

		container.querySelector<HTMLButtonElement>(".falah-mushaf-bottom-button.is-next")?.click();
		expect(nextPage).toHaveBeenCalledOnce();
	});
});

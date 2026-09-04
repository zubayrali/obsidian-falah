import type { Editor } from "obsidian";
import type { ReferenceContent, HadithContent, VerseContent } from "../data/schema";
import type { HadithResolver } from "../data/hadith/source";
import type { RefCache, SourceChain } from "../data/source";
import type { FalahSettings } from "../settings";
import {
	findReferences,
	type IslamicReference,
	type RenderedText,
	toCallout,
	toLabel,
	toMarkdownLink,
	toUri,
} from "../ref";
import { errMsg } from "../providers";
import { logMessage } from "../log";
import { t } from "../i18n";

export interface ReferenceActionsHost {
	cache: RefCache;
	sourceChain: SourceChain;
	hadith: HadithResolver;
	settings(): FalahSettings;
}

/** Fetches, formats, inserts, copies, and refreshes Islamic references. */
export class ReferenceActionsController {
	constructor(private host: ReferenceActionsHost) {}

	async getDetail(ref: IslamicReference): Promise<ReferenceContent> {
		if (ref.kind === "hadith") return this.host.hadith.getHadith(ref);
		const settings = this.host.settings();
		return this.host.sourceChain.getContent(ref, {
			script: settings.arabicScript,
			translationId: settings.translationResourceId || undefined,
			tafsirId: settings.tafsirResourceId || undefined,
		});
	}

	renderedText(content: ReferenceContent): RenderedText {
		if (content.ref.kind === "quran") {
			const verse = content as VerseContent;
			return {
				arabic: verse.arabic,
				translation: verse.translation,
				attribution: verse.surahNameEnglish ? `Surah ${verse.surahNameEnglish}` : undefined,
			};
		}
		const hadith = content as HadithContent;
		return {
			arabic: hadith.arabic,
			translation: hadith.translation,
			attribution: [hadith.bookName, hadith.grades].filter(Boolean).join(" · ") || undefined,
		};
	}

	async insert(editor: Editor, ref: IslamicReference): Promise<void> {
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
		} catch (error) {
			logMessage(t().noticeInsertedWithoutText(errMsg(error)), "warn");
		}
		editor.replaceRange(toCallout(ref, text) + "\n", cursor);
	}

	refUnderCursor(editor: Editor): IslamicReference | null {
		const cursor = editor.getCursor();
		const references = findReferences(editor.getLine(cursor.line));
		if (!references.length) return null;
		const hit = references.find((reference) =>
			cursor.ch >= reference.index && cursor.ch <= reference.index + reference.match.length,
		);
		return (hit ?? references[0]).ref;
	}

	async copyText(ref: IslamicReference): Promise<void> {
		try {
			const rendered = this.renderedText(await this.getDetail(ref));
			const parts = [toLabel(ref), rendered.arabic, rendered.translation].filter(Boolean) as string[];
			await navigator.clipboard.writeText(parts.join("\n\n"));
			logMessage(t().noticeReferenceTextCopied, "info");
		} catch (error) {
			logMessage(errMsg(error), "error");
		}
	}

	async refreshAtCursor(editor: Editor): Promise<void> {
		const cursor = editor.getCursor();
		const isQuote = (line: number) =>
			line >= 0 && line < editor.lineCount() && editor.getLine(line).startsWith(">");

		if (isQuote(cursor.line)) {
			let start = cursor.line;
			let end = cursor.line;
			while (isQuote(start - 1)) start--;
			while (isQuote(end + 1)) end++;
			const lines: string[] = [];
			for (let line = start; line <= end; line++) lines.push(editor.getLine(line));
			const references = findReferences(lines.join("\n"));
			if (references.length) {
				const ref = references[0].ref;
				this.host.cache.deletePrefix(toUri(ref) + "|");
				try {
					const text = this.renderedText(await this.getDetail(ref));
					editor.replaceRange(toCallout(ref, text), { line: start, ch: 0 }, { line: end, ch: editor.getLine(end).length });
					logMessage(t().noticeRefreshed(toLabel(ref)), "info");
				} catch (error) {
					logMessage(errMsg(error), "error");
				}
				return;
			}
		}

		const ref = this.refUnderCursor(editor);
		if (!ref) {
			logMessage(t().noticeNoReferenceUnderCursor, "warn");
			return;
		}
		this.host.cache.deletePrefix(toUri(ref) + "|");
		try {
			await this.getDetail(ref);
			logMessage(t().noticeCacheRefreshed(toLabel(ref)), "info");
		} catch (error) {
			logMessage(errMsg(error), "error");
		}
	}
}

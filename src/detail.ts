// Native detail surface — the Obsidian equivalent of Qirtaas' VerseDetailPanel /
// HadithDetailPanel: Arabic, translation, tafsir, navigation, copy actions, source link.

import { Modal } from "obsidian";
import type FalahPlugin from "./main";
import { IslamicReference, QuranRef, toLabel } from "./ref";
import type { HadithContent, VerseContent } from "./data/schema";
import { errMsg, hadithExternalUrl, quranExternalUrl } from "./providers";
import { logMessage } from "./log";
import { t } from "./i18n";

export class ReferenceDetailModal extends Modal {
	constructor(private plugin: FalahPlugin, private ref: IslamicReference) {
		super(plugin.app);
	}

	onOpen(): void {
		void this.render();
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(toLabel(this.ref));
		this.modalEl.addClass("falah-detail-modal");
		const body = contentEl.createDiv({ cls: "falah-detail" });
		body.createDiv({ cls: "falah-loading", text: "Loading…" });

		let detail: VerseContent | HadithContent;
		try {
			detail = await this.plugin.getDetail(this.ref);
		} catch (e) {
			body.empty();
			body.createDiv({ cls: "falah-error", text: errMsg(e) });
			const url =
				this.ref.kind === "quran"
					? quranExternalUrl(this.ref)
					: hadithExternalUrl(this.ref);
			this.actions(body, url, []);
			return;
		}

		body.empty();
		if (this.ref.kind === "quran") this.renderQuran(body, detail as VerseContent);
		else this.renderHadith(body, detail as HadithContent);
	}

	private renderQuran(body: HTMLElement, d: VerseContent): void {
		if (d.surahNameEnglish) {
			body.createDiv({
				cls: "falah-meta",
				text: [d.surahNameArabic, `Surah ${d.surahNameEnglish}`].filter(Boolean).join(" · "),
			});
		}
		const arabicEl = body.createDiv({ cls: "falah-arabic", text: d.arabic, attr: { dir: "rtl" } });
		arabicEl.style.fontFamily = this.plugin.arabicFontStack(this.plugin.settings.arabicScript);
		if (d.translation) body.createDiv({ cls: "falah-translation", text: d.translation });
		if (d.tafsir) {
			const det = body.createEl("details", { cls: "falah-tafsir" });
			det.createEl("summary", { text: "Tafsir" });
			det.createDiv({
				text: d.tafsir,
				attr: { dir: /[؀-ۿ]/.test(d.tafsir) ? "rtl" : "ltr" },
			});
		}

		const ref = this.ref as QuranRef;
		if (ref.toAyah === undefined) {
			// ponytail: prev/next stays within the surah; cross-surah nav needs an ayah-count table
			const nav = body.createDiv({ cls: "falah-nav" });
			const go = (ayah: number) => {
				this.ref = { kind: "quran", surah: ref.surah, ayah };
				void this.render();
			};
			const prev = nav.createEl("button", { text: "← Previous" });
			prev.disabled = ref.ayah <= 1;
			prev.onclick = () => go(ref.ayah - 1);
			const next = nav.createEl("button", { text: "Next →" });
			next.disabled = d.ayahCount !== undefined && ref.ayah >= d.ayahCount;
			next.onclick = () => go(ref.ayah + 1);
		}

		const readerRow = body.createDiv({ cls: "falah-open-reader-row" });
		const openBtn = readerRow.createEl("button", { text: "Open in reader" });
		openBtn.onclick = () => {
			this.close();
			void this.plugin.openReader(ref.surah, ref.ayah);
		};

		this.actions(body, d.externalUrl, [
			["Copy Arabic", d.arabic],
			["Copy translation", d.translation],
			["Copy citation", `${d.translation ?? d.arabic} — ${toLabel(ref)} (${d.externalUrl})`],
		]);
	}

	private renderHadith(body: HTMLElement, d: HadithContent): void {
		const meta = [d.bookName, d.grades].filter(Boolean).join(" · ");
		if (meta) body.createDiv({ cls: "falah-meta", text: meta });
		if (d.narrator) body.createDiv({ cls: "falah-meta", text: d.narrator });
		if (d.arabic) body.createDiv({ cls: "falah-arabic", text: d.arabic, attr: { dir: "rtl" } });
		if (d.translation) body.createDiv({ cls: "falah-translation", text: d.translation });
		if (!d.arabic && !d.translation) {
			body.createDiv({ cls: "falah-meta", text: "No text available from the provider." });
		}
		this.actions(body, d.externalUrl, [
			["Copy Arabic", d.arabic],
			["Copy translation", d.translation],
			[
				"Copy citation",
				`${d.translation ?? d.arabic ?? ""} — ${toLabel(this.ref)} (${d.externalUrl})`.trim(),
			],
		]);
	}

	private actions(body: HTMLElement, url: string, copies: Array<[string, string | undefined]>): void {
		const row = body.createDiv({ cls: "falah-actions" });
		for (const [label, text] of copies) {
			if (!text) continue;
			const b = row.createEl("button", { text: label });
			b.onclick = async () => {
				await navigator.clipboard.writeText(text);
				logMessage(t().noticeCopied, "info");
			};
		}
		row.createEl("a", { text: "Open source ↗", href: url, cls: "falah-external" });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

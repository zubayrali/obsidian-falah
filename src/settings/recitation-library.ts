import { Setting } from "obsidian";
import type FalahPlugin from "../main";
import type { Surah } from "../data/schema";
import { RECITERS } from "../audio/recitation";
import { errMsg } from "../providers";
import { logMessage } from "../log";
import { t } from "../i18n";
import { confirmAction } from "./confirm";

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export class RecitationLibraryZone {
	private selectedReciterId: string;
	private selectedSurah = 1;
	private surahs?: Surah[];
	private loadingSurahs?: Promise<void>;
	private activeDownload?: AbortController;
	private busy = false;
	private feedback = "";

	constructor(
		private readonly plugin: FalahPlugin,
		private readonly rerender: () => Promise<void>,
	) {
		this.selectedReciterId = plugin.settings.reciterId;
	}

	render(containerEl: HTMLElement): void {
		const manager = this.plugin.recitationOffline;
		if (!manager) {
			containerEl.createDiv({ cls: "falah-settings-error", text: t().libraryRecitationsUnavailable });
			return;
		}

		if (!this.surahs) {
			containerEl.createDiv({ cls: "falah-muted", text: t().libraryLoading });
			this.loadSurahs();
			return;
		}

		const reciter = RECITERS.find((item) => item.id === this.selectedReciterId) ?? RECITERS[0];
		if (reciter.id !== this.selectedReciterId) this.selectedReciterId = reciter.id;
		const surah = this.surahs.find((item) => item.number === this.selectedSurah) ?? this.surahs[0];
		if (surah.number !== this.selectedSurah) this.selectedSurah = surah.number;

		new Setting(containerEl)
			.setName(t().setReciterName)
			.setDesc(t().libraryRecitationReciterDesc)
			.addDropdown((dropdown) => {
				for (const item of RECITERS) dropdown.addOption(item.id, `${item.name} · ${item.bitrateKbps} kbps`);
				dropdown.setValue(reciter.id).setDisabled(this.busy).onChange(async (value) => {
					this.selectedReciterId = value;
					this.feedback = "";
					await this.rerender();
				});
			});

		new Setting(containerEl)
			.setName(t().libraryRecitationSurahName)
			.setDesc(t().libraryRecitationSurahDesc)
			.addDropdown((dropdown) => {
				for (const item of this.surahs!) {
					dropdown.addOption(String(item.number), `${item.number}. ${item.nameTransliterated}`);
				}
				dropdown.setValue(String(surah.number)).setDisabled(this.busy).onChange((value) => {
					this.selectedSurah = Number(value);
					this.feedback = "";
				});
			});

		const statusSetting = new Setting(containerEl)
			.setName(t().libraryRecitationOfflineName)
			.setDesc(t().libraryRecitationChecking);
		const statusEl = statusSetting.descEl;
		statusSetting.addButton((button) => {
			button
				.setButtonText(t().libraryRecitationRemove)
				.setWarning()
				.setDisabled(true)
				.onClick(async () => {
					if (this.busy) return;
					if (!await confirmAction(this.plugin.app, {
						title: t().confirmRemoveRecitationTitle,
						message: t().confirmRemoveRecitationDesc(reciter.name),
						confirmLabel: t().libraryRecitationRemove,
						cancelLabel: t().libraryCancelButton,
					})) return;
					this.busy = true;
					button.setDisabled(true);
					try {
						const removed = await manager.removeReciter(reciter);
						this.feedback = t().libraryRecitationRemoved(removed, reciter.name);
					} catch (error) {
						this.feedback = errMsg(error);
						logMessage(this.feedback, "error");
					} finally {
						this.busy = false;
						await this.rerender();
					}
				});
			void manager.status(reciter).then((status) => {
				if (!statusEl.isConnected) return;
				statusEl.setText(t().libraryRecitationStatus(
					status.cachedAyahs,
					status.completeSurahs.length,
					status.partialSurahs.length,
				));
				button.setDisabled(this.busy || status.cachedAyahs === 0);
			}).catch((error) => statusEl.setText(errMsg(error)));
		});

		const downloadSetting = new Setting(containerEl)
			.setName(t().libraryRecitationDownloadName(surah.nameTransliterated))
			.setDesc(t().libraryRecitationDownloadDesc(surah.ayahCount));
		downloadSetting.addButton((button) => button
			.setButtonText(t().libraryRecitationDownloadButton)
			.setCta()
			.setDisabled(this.busy)
			.onClick(async () => {
				if (this.busy) return;
				this.busy = true;
				this.feedback = "";
				button.setDisabled(true);
				const controller = new AbortController();
				this.activeDownload = controller;
				const progressRow = containerEl.createDiv({ cls: "falah-recitation-download-progress" });
				const label = progressRow.createSpan({
					text: t().libraryRecitationProgress(reciter.name, 0, surah.ayahCount),
				});
				const progress = progressRow.createEl("progress");
				progress.max = surah.ayahCount;
				progress.value = 0;
				const cancel = progressRow.createEl("button", { text: t().libraryCancelButton });
				cancel.onclick = () => controller.abort();
				try {
					const result = await manager.downloadSurahs(reciter, [surah.number], (value) => {
						progress.max = value.total;
						progress.value = value.completed;
						label.setText(t().libraryRecitationProgress(reciter.name, value.completed, value.total));
					}, controller.signal);
					this.feedback = t().libraryRecitationComplete(surah.nameTransliterated, result.skipped);
				} catch (error) {
					if (isAbortError(error)) this.feedback = t().libraryRecitationCancelled;
					else {
						this.feedback = errMsg(error);
						logMessage(this.feedback, "error");
					}
				} finally {
					this.activeDownload = undefined;
					this.busy = false;
					progressRow.remove();
					await this.rerender();
				}
			}));

		if (this.feedback) containerEl.createDiv({ cls: "falah-recitation-feedback", text: this.feedback });
	}

	dispose(): void {
		this.activeDownload?.abort();
	}

	private loadSurahs(): void {
		if (this.loadingSurahs) return;
		this.loadingSurahs = this.plugin.registry.core.getSurahs()
			.then((surahs) => { this.surahs = surahs; })
			.catch((error) => {
				this.feedback = errMsg(error);
				logMessage(this.feedback, "error");
			})
			.finally(async () => {
				this.loadingSurahs = undefined;
				await this.rerender();
			});
	}
}

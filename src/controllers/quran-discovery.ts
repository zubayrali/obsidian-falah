import type { App } from "obsidian";
import type { Registry } from "../data/registry";
import type { QuranDataSource } from "../data/source";
import { errMsg } from "../providers";
import { t } from "../i18n";
import { logMessage } from "../log";
import { QuranBrowseModal } from "../nav/browse-modal";
import type { OfflineQuranSearchIndex } from "../search";
import { loadOfflineSearchIndex } from "../search/load";
import { OfflineSearchModal } from "../search/modal";

export interface QuranDiscoveryHost {
	app: App;
	registry: Registry;
	quranData: QuranDataSource;
	navigate(surah: number, ayah: number): void;
}

/** Owns the browse/search modal orchestration and the reusable offline index. */
export class QuranDiscoveryController {
	private index?: OfflineQuranSearchIndex;
	private indexBuild?: Promise<OfflineQuranSearchIndex>;

	constructor(private host: QuranDiscoveryHost) {}

	invalidateIndex(): void {
		this.index = undefined;
		this.indexBuild = undefined;
	}

	openBrowse(): void {
		new QuranBrowseModal({
			app: this.host.app,
			load: async () => {
				const [surahs, nav] = await Promise.all([
					this.host.registry.core.getSurahs(),
					this.host.registry.core.getNav(),
				]);
				return { surahs, nav };
			},
			navigate: (surah, ayah) => this.host.navigate(surah, ayah),
			title: t().navBrowseTitle,
			loadingText: t().readerLoading,
			errorText: (error) => errMsg(error),
		}).open();
	}

	async openOfflineSearch(): Promise<void> {
		if (!this.index) {
			this.indexBuild ??= loadOfflineSearchIndex(this.host.quranData, {
				onProgress: ({ indexed, total }) => {
					if (indexed === total) logMessage(t().noticeSearchIndexReady, "info");
				},
			});
			this.index = await this.indexBuild;
		}
		new OfflineSearchModal({
			app: this.host.app,
			index: this.index,
			navigate: (surah, ayah) => this.host.navigate(surah, ayah),
			placeholder: t().searchOfflinePlaceholder,
		}).open();
	}
}

import type { App } from "obsidian";
import type { BookmarkStoreService } from "../bookmarks/store";
import { exportMarkdown, importText } from "../bookmarks/markdown";
import { resolveRow, type AvailabilitySnapshot } from "../bookmarks/resolve";
import type { QuranDataSource } from "../data/source";
import type { HadithResolver } from "../data/hadith/source";
import { errMsg } from "../providers";
import { logMessage } from "../log";
import { t } from "../i18n";

export interface BookmarkOperationsHost {
	app: App;
	bookmarks: BookmarkStoreService;
	quranData: QuranDataSource;
	hadith: HadithResolver;
	bookmarksPath(): string;
}

/** Coordinates bookmark persistence formats and installed-content availability. */
export class BookmarkOperationsController {
	constructor(private host: BookmarkOperationsHost) {}

	async installedHadithCollections(): Promise<string[]> {
		return (await this.host.hadith.listBrowsable()).map((collection) => collection.collection);
	}

	async availabilitySnapshot(): Promise<AvailabilitySnapshot> {
		const editions = new Set(
			(await this.host.quranData.listResources())
				.filter((resource) => resource.type === "translation" || resource.type === "tafsir")
				.map((resource) => resource.id),
		);
		return { editions, collections: new Set(await this.installedHadithCollections()) };
	}

	async export(): Promise<void> {
		const markdown = exportMarkdown({ version: 1, groups: this.host.bookmarks.list() });
		const configuredPath = this.host.bookmarksPath();
		const directory = configuredPath.includes("/") ? configuredPath.slice(0, configuredPath.lastIndexOf("/")) : "";
		const path = directory ? `${directory}/Bookmarks.md` : "Bookmarks.md";
		try {
			if (directory && !(await this.host.app.vault.adapter.exists(directory))) {
				await this.host.app.vault.adapter.mkdir(directory);
			}
			await this.host.app.vault.adapter.write(path, markdown);
			logMessage(t().noticeBookmarksExported(path), "info");
		} catch (error) {
			logMessage(t().noticeBookmarksExportFailed(errMsg(error)), "warn");
		}
	}

	async import(text: string): Promise<void> {
		for (const group of importText(text).groups) {
			for (const item of group.items) {
				if (!this.host.bookmarks.has(item.anchor, item.lens)) {
					await this.host.bookmarks.add({
						anchor: item.anchor,
						lens: item.lens,
						note: item.note,
						group: group.name,
					});
				}
			}
		}
		logMessage(t().noticeBookmarksImported, "info");
	}

	async cleanup(): Promise<void> {
		const snapshot = await this.availabilitySnapshot();
		let removed = 0;
		for (const group of [...this.host.bookmarks.list()]) {
			for (const item of [...group.items]) {
				// Uninstalled content and dormant lenses remain recoverable stubs.
				if (!resolveRow(item, snapshot).anchorOk) {
					await this.host.bookmarks.remove(item.id);
					removed++;
				}
			}
		}
		logMessage(t().noticeBookmarksCleanedUp(removed), "info");
	}
}

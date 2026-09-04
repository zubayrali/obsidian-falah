import { Setting } from "obsidian";
import type FalahPlugin from "../main";
import type { BookmarkSort } from "../bookmarks/sort";
import { t } from "../i18n";
import { logMessage } from "../log";
import { DEFAULT_SETTINGS } from "../settings";
import { createSettingsPageIntro, createSettingsSection } from "./ui";
import { confirmAction } from "./confirm";

export function renderAdvancedZone(plugin: FalahPlugin, containerEl: HTMLElement): void {
	createSettingsPageIntro(containerEl, t().setAdvancedPageTitle, t().setAdvancedPageDesc);

	const progress = createSettingsSection(containerEl, {
		id: "advanced-progress",
		title: t().setAdvancedProgressHeading,
		description: t().setAdvancedProgressDesc,
		icon: "map-pin-check",
		open: true,
	});
	new Setting(progress)
		.setName(t().setProgressEnabledName)
		.setDesc(t().setProgressEnabledDesc)
		.addToggle((toggle) => toggle.setValue(plugin.settings.progressEnabled).onChange(async (value) => {
			plugin.settings.progressEnabled = value;
			await plugin.persist();
		}));
	let pendingProgressPath = plugin.settings.progressPath;
	new Setting(progress)
		.setName(t().setProgressPathName)
		.setDesc(t().setProgressPathDesc)
		.addText((text) => text.setValue(plugin.settings.progressPath).onChange((value) => {
			pendingProgressPath = value.trim() || DEFAULT_SETTINGS.progressPath;
		}))
		.addButton((button) => button.setButtonText(t().setApplyButton).onClick(async () => {
			await plugin.progress.switchPath(pendingProgressPath);
			plugin.settings.progressPath = pendingProgressPath;
			await plugin.persist();
		}));
	new Setting(progress)
		.setName(t().setClearProgressName)
		.setDesc(t().setClearProgressDesc)
		.addButton((button) => button.setButtonText(t().setClearProgressButton).setWarning().onClick(async () => {
			if (!await confirmAction(plugin.app, {
				title: t().confirmClearProgressTitle,
				message: t().confirmClearProgressDesc,
				confirmLabel: t().setClearProgressButton,
				cancelLabel: t().libraryCancelButton,
			})) return;
			await plugin.progress.clear();
			logMessage(t().noticeProgressCleared, "info");
		}));

	const bookmarks = createSettingsSection(containerEl, {
		id: "advanced-bookmarks",
		title: t().setHeadingBookmarks,
		description: t().setAdvancedBookmarksDesc,
		icon: "bookmark",
	});
	new Setting(bookmarks)
		.setName(t().setBookmarkDefaultCollectionName)
		.setDesc(t().setBookmarkDefaultCollectionDesc)
		.addDropdown((dropdown) => {
			const names = Array.from(new Set(["Bookmarks", ...plugin.bookmarks.list().map((group) => group.name)]));
			for (const name of names) dropdown.addOption(name, name);
			dropdown.setValue(plugin.settings.bookmarkDefaultCollection);
			dropdown.onChange(async (value) => {
				plugin.settings.bookmarkDefaultCollection = value || "Bookmarks";
				await plugin.persist();
				plugin.bookmarks.setDefaultGroup(value || "Bookmarks");
			});
		});
	new Setting(bookmarks)
		.setName(t().setBookmarkShowFavouritesName)
		.setDesc(t().setBookmarkShowFavouritesDesc)
		.addToggle((toggle) => toggle.setValue(plugin.settings.bookmarkShowFavourites).onChange(async (value) => {
			plugin.settings.bookmarkShowFavourites = value;
			await plugin.persist();
		}));
	new Setting(bookmarks)
		.setName(t().setBookmarkSortName)
		.addDropdown((dropdown) => {
			dropdown.addOption("added", t().sortAddedLabel);
			dropdown.addOption("manual", t().sortManualLabel);
			dropdown.addOption("surah", t().sortSurahLabel);
			dropdown.setValue(plugin.settings.bookmarkSort);
			dropdown.onChange(async (value) => {
				plugin.settings.bookmarkSort = value as BookmarkSort;
				await plugin.persist();
			});
		});
	new Setting(bookmarks)
		.setName(t().setBookmarkRecentCountName)
		.setDesc(t().setBookmarkRecentCountDesc)
		.addText((text) => text.setValue(String(plugin.settings.bookmarkRecentCount)).onChange(async (value) => {
			const count = Math.max(0, Math.floor(Number(value) || 0));
			plugin.settings.bookmarkRecentCount = count;
			plugin.bookmarks.setRecentCap(count);
			await plugin.persist();
		}));
	new Setting(bookmarks)
		.setName(t().setBookmarksPathName)
		.setDesc(t().setBookmarksPathDesc)
		.addText((text) => text
			.setPlaceholder(DEFAULT_SETTINGS.bookmarksPath)
			.setValue(plugin.settings.bookmarksPath)
			.onChange(async (value) => {
				plugin.settings.bookmarksPath = value.trim() || DEFAULT_SETTINGS.bookmarksPath;
				await plugin.persist();
			}));

	const online = createSettingsSection(containerEl, {
		id: "advanced-online-fallback",
		title: t().setAdvancedOnlineHeading,
		description: t().setAdvancedOnlineDesc,
		icon: "cloud-download",
	});
	new Setting(online)
		.setName(t().setOnlineFallbackTranslationName)
		.setDesc(t().setOnlineFallbackTranslationDesc)
		.addText((text) => text
			.setPlaceholder(DEFAULT_SETTINGS.translationEdition)
			.setValue(plugin.settings.translationEdition)
			.onChange(async (value) => {
				plugin.settings.translationEdition = value.trim() || DEFAULT_SETTINGS.translationEdition;
				await plugin.persist();
			}));
	new Setting(online)
		.setName(t().setOnlineFallbackTafsirName)
		.setDesc(t().setOnlineFallbackTafsirDesc)
		.addText((text) => text.setValue(plugin.settings.tafsirEdition).onChange(async (value) => {
			plugin.settings.tafsirEdition = value.trim();
			await plugin.persist();
		}));

	const storage = createSettingsSection(containerEl, {
		id: "advanced-storage",
		title: t().setAdvancedStorageHeading,
		description: t().setAdvancedStorageDesc,
		icon: "database",
	});
	new Setting(storage)
		.setName(t().setClearCacheName)
		.setDesc(t().setClearCacheDesc)
		.addButton((button) => button.setButtonText(t().libraryClearButton).setWarning().onClick(async () => {
			if (!await confirmAction(plugin.app, {
				title: t().confirmClearCacheTitle,
				message: t().confirmClearCacheDesc,
				confirmLabel: t().libraryClearButton,
				cancelLabel: t().libraryCancelButton,
			})) return;
			plugin.cache.deletePrefix("");
			logMessage(t().noticeCacheCleared, "info");
		}));
}

import type { Command, WorkspaceLeaf } from "obsidian";
import type FalahPlugin from "../main";
import { t } from "../i18n";
import { logMessage } from "../log";
import { toUri } from "../ref";
import { NavigateModal } from "../nav/navigate-modal";
import { HadithCollectionPickerModal, HonorificModal, QuranSearchModal } from "../suggest";

/** Small lifecycle seam between the plugin shell and user-facing commands. */
export interface CommandRegistrationHost {
	plugin: FalahPlugin;
	addCommand(command: Command): void;
	addRibbonIcon(icon: string, title: string, callback: () => void): void;
	findReaderLeaf(): WorkspaceLeaf | undefined;
}

export function registerCommands(host: CommandRegistrationHost): void {
	const plugin = host.plugin;
	host.addRibbonIcon("book-open", t().ribbonOpenReader, () => void plugin.openReader());
	host.addCommand({
		id: "open-quran-reader",
		name: t().cmdOpenReader,
		callback: () => void plugin.openReader(),
	});
	host.addCommand({
		id: "continue-reading",
		name: t().cmdContinueReading,
		checkCallback: (checking) => {
			const target = plugin.progress.resumeTarget();
			if (!plugin.settings.progressEnabled || !target) return false;
			if (!checking) void plugin.openReader(target.surah, target.ayah);
			return true;
		},
	});
	host.addCommand({ id: "recitation-play-pause", name: t().cmdRecitationPlayPause, callback: () => void plugin.recitation.dispatch({ type: "toggle" }) });
	host.addCommand({ id: "recitation-next", name: t().cmdRecitationNext, callback: () => void plugin.recitation.dispatch({ type: "next" }) });
	host.addCommand({ id: "recitation-previous", name: t().cmdRecitationPrevious, callback: () => void plugin.recitation.dispatch({ type: "previous" }) });
	host.addCommand({
		id: "pop-out-quran-reader",
		name: t().cmdPopOutReader,
		callback: () => {
			const leaf = host.findReaderLeaf();
			if (leaf) plugin.app.workspace.moveLeafToPopout(leaf);
			else logMessage(t().noticeOpenReaderFirst, "warn");
		},
	});
	host.addCommand({
		id: "jump-to",
		name: t().cmdJumpTo,
		callback: () => new NavigateModal(plugin).open(),
	});
	host.addCommand({ id: "browse-quran", name: t().cmdBrowseQuran, callback: () => plugin.openQuranBrowse() });
	host.addCommand({ id: "search-quran-offline", name: t().cmdSearchQuranOffline, callback: () => void plugin.openOfflineSearch() });
	host.addCommand({
		id: "insert-quran",
		name: t().cmdInsertQuran,
		editorCallback: (editor) => new QuranSearchModal(plugin, (ref) => {
			if (ref) void plugin.insertReference(editor, ref);
		}).open(),
	});
	host.addCommand({ id: "insert-hadith", name: t().cmdInsertHadith, editorCallback: (editor) => new HadithCollectionPickerModal(plugin, editor).open() });
	host.addCommand({ id: "insert-honorific", name: t().cmdInsertHonorific, editorCallback: (editor) => new HonorificModal(plugin, editor).open() });
	host.addCommand({
		id: "open-detail",
		name: t().cmdOpenDetail,
		editorCheckCallback: (checking, editor) => {
			const ref = plugin.refUnderCursor(editor);
			if (!ref) return false;
			if (!checking) plugin.openDetail(ref);
			return true;
		},
	});
	host.addCommand({
		id: "copy-reference-text",
		name: t().cmdCopyReferenceText,
		editorCheckCallback: (checking, editor) => {
			const ref = plugin.refUnderCursor(editor);
			if (!ref) return false;
			if (!checking) void plugin.copyReferenceText(ref);
			return true;
		},
	});
	host.addCommand({ id: "refresh-reference", name: t().cmdRefreshReference, editorCallback: (editor) => void plugin.refreshAtCursor(editor) });
	host.addRibbonIcon("bookmark", t().ribbonOpenBookmarks, () => void plugin.openBookmarks());
	host.addCommand({ id: "open-bookmarks", name: t().cmdOpenBookmarks, callback: () => void plugin.openBookmarks() });
	host.addCommand({
		id: "bookmark-under-cursor",
		name: t().cmdBookmarkUnderCursor,
		editorCheckCallback: (checking, editor) => {
			const ref = plugin.refUnderCursor(editor);
			if (!ref) return false;
			if (!checking) void plugin.bookmarks.add({ anchor: toUri(ref) });
			return true;
		},
	});
	host.addCommand({ id: "export-bookmarks", name: t().cmdExportBookmarks, callback: () => void plugin.exportBookmarks() });
	host.addCommand({ id: "import-bookmarks", name: t().cmdImportBookmarks, editorCallback: (editor) => void plugin.importBookmarks(editor.getValue()) });
	host.addCommand({ id: "cleanup-bookmarks", name: t().cmdCleanupBookmarks, callback: () => void plugin.cleanupBookmarks() });
}

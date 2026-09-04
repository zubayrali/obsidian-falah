// Bookmarks leaf view: shows a ★ Favourites section plus manageable,
// collapsible collections, degrading gracefully when the underlying
// edition/collection isn't installed. Never fetches verse/tafsir text — rows
// render from stored fields plus an O(1) availability snapshot built once per
// render. Obsidian-runtime module (mirrors QuranReaderView in reader.ts), not
// vitest-importable.

import { ItemView, Menu, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type FalahPlugin from "../main";
import { parseRefUri, toLabel } from "../ref";
import { t } from "../i18n";
import { resolveRow, type AvailabilitySnapshot, type Badge } from "./resolve";
import { sortBookmarks, type BookmarkSort } from "./sort";
import { promptName } from "./prompt";
import type { Bookmark, BookmarkGroup, RecentEntry } from "./schema";

export const VIEW_TYPE_BOOKMARKS = "falah-bookmarks";

export class BookmarksView extends ItemView {
	private unsub?: () => void;

	constructor(leaf: WorkspaceLeaf, private plugin: FalahPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_BOOKMARKS;
	}
	getDisplayText(): string {
		return t().bookmarksViewTitle;
	}
	getIcon(): string {
		return "bookmark";
	}

	async onOpen(): Promise<void> {
		this.unsub = this.plugin.bookmarks.onChange(() => void this.render());
		await this.render();
	}

	async onClose(): Promise<void> {
		this.unsub?.();
	}

	/** Built once per render: O(installed) to assemble, O(1) per row to consult.
	 *  Listing never fetches verse/tafsir text — only these two id sets.
	 *  Delegates to the plugin's single source of truth (also used by
	 *  cleanupBookmarks()) so the set-building logic isn't duplicated. */
	private snapshot(): Promise<AvailabilitySnapshot> {
		return this.plugin.availabilitySnapshot();
	}

	private openAnchor(item: Bookmark): void {
		this.openRef(item.anchor);
	}

	private openRef(anchor: string): void {
		const ref = parseRefUri(anchor);
		if (!ref) return;
		if (ref.kind === "quran") void this.plugin.openReader(ref.surah, ref.ayah);
		else this.plugin.openDetail(ref);
	}

	private async render(): Promise<void> {
		const snap = await this.snapshot();
		const bm = this.plugin.bookmarks;
		const groups = bm.list();
		const sort = this.plugin.settings.bookmarkSort;
		const root = this.contentEl;
		root.empty();
		root.addClass("falah-bookmarks");

		const header = root.createDiv({ cls: "falah-bookmarks-header" });
		header.createEl("h2", { text: t().bookmarksViewTitle });
		const unresolvable = groups.flatMap((g) => g.items).filter((item) => !resolveRow(item, snap).anchorOk);
		if (unresolvable.length) {
			const cleanupBtn = header.createEl("button", {
				cls: "falah-bookmarks-cleanup",
				text: t().bookmarksCleanupButton(unresolvable.length),
			});
			cleanupBtn.onclick = () => void this.cleanupUnresolvable(unresolvable);
		}

		const newBtn = root.createEl("button", { cls: "falah-bookmarks-new" });
		setIcon(newBtn, "plus");
		newBtn.createSpan({ text: t().bookmarksNewCollection });
		newBtn.onclick = async () => {
			const name = await promptName(this.app, t().bookmarksNewCollection, "", t().bookmarkPromptCreate);
			if (name) await bm.createGroup(name);
		};

		// Recent is stored independently of collections, so it must not be
		// gated behind "there is at least one collection" below.
		const recent = this.plugin.settings.bookmarkRecentCount > 0 ? bm.listRecent() : [];

		if (!groups.length && !recent.length) {
			root.createDiv({ cls: "falah-bookmarks-empty", text: t().bookmarksEmpty });
			return;
		}

		if (this.plugin.settings.bookmarkShowFavourites && bm.favourites().length) {
			const section = root.createDiv({ cls: "falah-bookmarks-section falah-bookmarks-favourites" });
			const favourites = section.createEl("h3", { cls: "falah-bookmarks-favourites-head" });
			const icon = favourites.createSpan({ cls: "falah-bookmarks-heading-icon" });
			setIcon(icon, "star");
			favourites.createSpan({ text: t().bookmarksFavouritesHeading });
			for (const item of sortBookmarks(bm.favourites(), sort)) this.renderRow(section, item, snap);
		}

		if (recent.length) {
			const section = root.createDiv({ cls: "falah-bookmarks-section falah-bookmarks-recent" });
			const recentHead = section.createDiv({ cls: "falah-bookmarks-recent-head" });
			recentHead.createEl("h3", { cls: "falah-bookmarks-recent-title", text: t().bookmarksRecentHeading });
			const clearBtn = recentHead.createEl("button", {
				cls: "falah-bookmarks-recent-clear",
				text: t().bookmarksRecentClear,
			});
			clearBtn.onclick = () => void bm.clearRecent();
			// Rendered read-only, in the store's own newest-first order — never
			// sorted or mutated (this is the store's internal array).
			for (const entry of recent) this.renderRecentRow(section, entry);
		}

		for (const group of groups) {
			this.renderCollection(root, group, snap, sort);
		}
	}

	private renderCollection(root: HTMLElement, group: BookmarkGroup, snap: AvailabilitySnapshot, sort: BookmarkSort): void {
		const bm = this.plugin.bookmarks;
		const isDefault = group.name === bm.getDefaultGroup();

		const wrap = root.createDiv({ cls: "falah-bookmark-collection" });
		const head = wrap.createDiv({ cls: "falah-bookmark-collection-head" });
		const toggle = head.createEl("button", {
			cls: "falah-bookmark-collection-toggle",
			attr: { "aria-expanded": String(!group.collapsed) },
		});
		toggle.type = "button";
		const chevron = toggle.createSpan({ cls: "falah-bookmark-collection-chevron" });
		setIcon(chevron, group.collapsed ? "chevron-right" : "chevron-down");
		toggle.createSpan({ cls: "falah-bookmark-collection-name", text: group.name });
		toggle.createSpan({ cls: "falah-bookmark-collection-count", text: `(${group.items.length})` });

		if (!isDefault) {
			const menuBtn = head.createEl("button", {
				cls: "falah-bookmark-collection-menu falah-icon-button",
				attr: { "aria-label": t().bookmarkCollectionMenu },
			});
			setIcon(menuBtn, "ellipsis");
			menuBtn.onclick = (e) => {
				e.stopPropagation();
				const menu = new Menu();
				menu.addItem((mi) =>
					mi
						.setTitle(t().bookmarksRenameCollection)
						.setIcon("pencil")
						.onClick(async () => {
							const name = await promptName(this.app, t().bookmarksRenameCollection, group.name, t().bookmarkPromptRename);
							if (name) await bm.renameGroup(group.id, name);
						})
				);
				menu.addItem((mi) =>
					mi
						.setTitle(t().bookmarksDeleteCollection)
						.setIcon("trash")
						.onClick(() => void bm.deleteGroup(group.id))
				);
				menu.showAtMouseEvent(e);
			};
		}

		const toggleCollapsed = () => void bm.setCollapsed(group.id, !group.collapsed);
		toggle.onclick = toggleCollapsed;

		if (group.collapsed) return;
		for (const item of sortBookmarks(group.items, sort)) this.renderRow(wrap, item, snap);
	}

	private renderRow(root: HTMLElement, item: Bookmark, snap: AvailabilitySnapshot): void {
		const bm = this.plugin.bookmarks;
		const state = resolveRow(item, snap);
		const row = root.createDiv({ cls: "falah-bookmark-row" });
		if (!state.anchorOk) row.addClass("falah-bookmark-row-unresolvable");
		else if (state.lensState === "dormant") row.addClass("falah-bookmark-row-dormant");

		const fav = bm.isFavourite(item.anchor, item.lens);
		const star = row.createEl("button", {
			cls: "falah-bookmark-star falah-icon-button",
			attr: { "aria-label": fav ? t().bookmarkUnfavourite : t().bookmarkFavourite },
		});
		setIcon(star, "star");
		if (fav) star.addClass("is-favourite");
		star.onclick = (e) => {
			e.stopPropagation();
			void bm.setFavourite(item.anchor, !fav, item.lens);
		};

		const main = row.createEl("button", { cls: "falah-bookmark-main" });
		main.type = "button";
		main.createSpan({ cls: "falah-bookmark-label", text: state.label });
		if (item.note) main.createSpan({ cls: "falah-bookmark-note", text: item.note });
		if (state.badge) main.createSpan({ cls: "falah-bookmark-badge", text: this.badgeText(state.badge) });
		main.onclick = () => this.openAnchor(item);

		const removeBtn = row.createEl("button", {
			cls: "falah-bookmark-remove falah-icon-button",
			attr: { "aria-label": t().bookmarkRemove },
		});
		setIcon(removeBtn, "x");
		removeBtn.onclick = (e) => {
			e.stopPropagation();
			void bm.remove(item.id);
		};

		row.oncontextmenu = (e) => {
			const menu = new Menu();
			const currentGroupId = bm.list().find((g) => g.items.some((i) => i.id === item.id))?.id;
			const others = bm.list().filter((g) => g.id !== currentGroupId);
			if (others.length) {
				menu.addItem((mi) => mi.setTitle(t().bookmarkMoveTo).setIsLabel(true));
				for (const g of others) {
					menu.addItem((mi) =>
						mi
							.setTitle(g.name)
							.setIcon("folder-input")
							.onClick(() => void bm.moveItem(item.id, g.id))
					);
				}
				menu.addSeparator();
			}
			menu.addItem((mi) =>
				mi
					.setTitle(t().bookmarkRemove)
					.setIcon("trash")
					.onClick(() => void bm.remove(item.id))
			);
			menu.showAtMouseEvent(e);
		};
	}

	/** Recent rows are time-ordered, unmanaged pointers — no star/note/collection
	 *  actions, just a label to open and a way to promote the anchor into a
	 *  collection. Kept separate from renderRow, which expects a Bookmark. */
	private renderRecentRow(root: HTMLElement, entry: RecentEntry): void {
		const bm = this.plugin.bookmarks;
		const ref = parseRefUri(entry.anchor);
		const label = ref ? toLabel(ref) : entry.anchor;

		const row = root.createDiv({ cls: "falah-bookmark-recent-row" });

		const main = row.createEl("button", { cls: "falah-bookmark-main" });
		main.type = "button";
		main.createSpan({ cls: "falah-bookmark-label", text: label });
		main.onclick = () => this.openRef(entry.anchor);

		const saveBtn = row.createEl("button", {
			cls: "falah-bookmark-recent-save",
		});
		setIcon(saveBtn, "plus");
		saveBtn.createSpan({ text: t().bookmarksRecentSave });
		saveBtn.onclick = async () => {
			const name = await promptName(this.app, t().bookmarksNewCollection, "", t().bookmarkPromptCreate);
			if (name) await bm.add({ anchor: entry.anchor, group: name });
		};
	}

	private badgeText(b: Badge): string {
		switch (b.kind) {
			case "invalid":
				return t().bookmarkBadgeInvalid;
			case "collection-missing":
				return t().bookmarkBadgeCollectionMissing(b.collection);
			case "lens-dormant":
				return t().bookmarkBadgeLensDormant(b.editionId);
		}
	}

	private async cleanupUnresolvable(items: Bookmark[]): Promise<void> {
		for (const item of items) await this.plugin.bookmarks.remove(item.id);
	}
}

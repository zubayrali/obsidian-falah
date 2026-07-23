// Bookmarks leaf view: shows a ★ Favourites section plus manageable,
// collapsible collections, degrading gracefully when the underlying
// edition/collection isn't installed. Never fetches verse/tafsir text — rows
// render from stored fields plus an O(1) availability snapshot built once per
// render. Obsidian-runtime module (mirrors QuranReaderView in reader.ts), not
// vitest-importable.

import { ItemView, Menu } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type FalahPlugin from "../main";
import { parseRefUri } from "../ref";
import { t } from "../i18n";
import { resolveRow, type AvailabilitySnapshot, type Badge } from "./resolve";
import { sortBookmarks, type BookmarkSort } from "./sort";
import { promptName } from "./prompt";
import type { Bookmark, BookmarkGroup } from "./schema";

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
		const ref = parseRefUri(item.anchor);
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

		const newBtn = root.createEl("button", { cls: "falah-bookmarks-new", text: `＋ ${t().bookmarksNewCollection}` });
		newBtn.onclick = async () => {
			const name = await promptName(this.app, t().bookmarksNewCollection, "", t().bookmarkPromptCreate);
			if (name) await bm.createGroup(name);
		};

		if (!groups.length) {
			root.createDiv({ cls: "falah-bookmarks-empty", text: t().bookmarksEmpty });
			return;
		}

		if (this.plugin.settings.bookmarkShowFavourites && bm.favourites().length) {
			root.createEl("h3", { cls: "falah-bookmarks-favourites-head", text: t().bookmarksFavouritesHeading });
			for (const item of sortBookmarks(bm.favourites(), sort)) this.renderRow(root, item, snap);
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
		head.createSpan({ cls: "falah-bookmark-collection-chevron", text: group.collapsed ? "▸" : "▾" });
		head.createSpan({ cls: "falah-bookmark-collection-name", text: group.name });
		head.createSpan({ cls: "falah-bookmark-collection-count", text: `(${group.items.length})` });

		if (!isDefault) {
			const menuBtn = head.createEl("button", {
				cls: "falah-bookmark-collection-menu",
				text: "⋯",
				attr: { "aria-label": t().bookmarkCollectionMenu },
			});
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
		head.onclick = toggleCollapsed;
		head.setAttribute("role", "button");
		head.setAttribute("tabindex", "0");
		head.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleCollapsed();
			}
		});

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
			cls: "falah-bookmark-star",
			text: fav ? "★" : "☆",
			attr: { "aria-label": fav ? t().bookmarkUnfavourite : t().bookmarkFavourite },
		});
		if (fav) star.addClass("is-favourite");
		star.onclick = (e) => {
			e.stopPropagation();
			void bm.setFavourite(item.anchor, !fav, item.lens);
		};

		const main = row.createDiv({ cls: "falah-bookmark-main" });
		main.createSpan({ cls: "falah-bookmark-label", text: state.label });
		if (item.note) main.createSpan({ cls: "falah-bookmark-note", text: item.note });
		if (state.badge) main.createSpan({ cls: "falah-bookmark-badge", text: this.badgeText(state.badge) });
		main.onClickEvent(() => this.openAnchor(item));

		const removeBtn = row.createEl("button", { cls: "falah-bookmark-remove", text: t().bookmarkRemove });
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

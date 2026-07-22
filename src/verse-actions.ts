// Extensible per-verse action registry. Actions return plain menu-item specs;
// only the reader turns them into an Obsidian Menu. Pure module — NO "obsidian"
// import — so it stays vitest-testable. Audio/journaling add actions later by
// calling plugin.registerVerseAction(); nothing here or in the reader changes.

import type FalahPlugin from "./main";
import { toUri, type QuranRef } from "./ref";
import type { ResourceDescriptor } from "./data/schema";

/** The slice of the reader that actions manipulate — implemented by QuranReaderView. */
export interface VerseView {
	isVerseTafsirShown(ayahKey: string, tafsirId: string): boolean;
	toggleVerseTafsir(ayahKey: string, tafsirId: string): void | Promise<void>;
}

export interface VerseContext {
	surah: number;
	ayah: number;
	ayahKey: string;
	arabic: string;
	translation?: string;
	plugin: FalahPlugin;
	view: VerseView;
}

export interface VerseMenuItem {
	title: string;
	icon?: string;
	section?: string;
	checked?: boolean;
	/** If present, this item opens a nested menu of these children instead of
	 *  firing onClick — keeps the top-level menu uncluttered. */
	submenu?: VerseMenuItem[];
	onClick?: () => void | Promise<void>;
}

export interface VerseAction {
	id: string;
	/** Zero or more menu items for this verse. Async so an action may fetch first. */
	items(ctx: VerseContext): VerseMenuItem[] | Promise<VerseMenuItem[]>;
}

/** One toggle item per installed tafsir, checked when shown on this verse. Pure. */
export function tafsirMenuItems(installedTafsirs: ResourceDescriptor[], ctx: VerseContext): VerseMenuItem[] {
	return installedTafsirs.map((t) => ({
		title: t.name,
		section: "falah-tafsir",
		checked: ctx.view.isVerseTafsirShown(ctx.ayahKey, t.id),
		onClick: () => ctx.view.toggleVerseTafsir(ctx.ayahKey, t.id),
	}));
}

/** The Phase-1 verse actions. Order here is the menu order. */
export function defaultVerseActions(): VerseAction[] {
	return [
		{
			id: "bookmark",
			items(ctx) {
				const anchor = toUri({ kind: "quran", surah: ctx.surah, ayah: ctx.ayah });
				const saved = ctx.plugin.bookmarks.has(anchor);
				const fav = ctx.plugin.bookmarks.isFavourite(anchor);
				const out: VerseMenuItem[] = [];
				if (saved) {
					out.push({
						title: "Remove bookmark", section: "falah-bookmark", icon: "bookmark-minus",
						checked: true, onClick: () => ctx.plugin.bookmarks.remove(anchor),
					});
				} else {
					const def = ctx.plugin.settings.bookmarkDefaultCollection;
					out.push({
						title: "Bookmark verse", section: "falah-bookmark", icon: "bookmark",
						onClick: () => void ctx.plugin.bookmarks.add({ anchor, group: def }),
					});
					const submenu: VerseMenuItem[] = ctx.plugin.bookmarks.list().map((g) => ({
						title: g.name,
						onClick: () => void ctx.plugin.bookmarks.add({ anchor, group: g.name }),
					}));
					submenu.push({
						title: "New collection…",
						onClick: () => ctx.plugin.newCollectionFor(anchor),
					});
					out.push({ title: "Bookmark to", section: "falah-bookmark", icon: "folder", submenu });
				}
				out.push({
					title: fav ? "Remove from favourites" : "Add to favourites",
					section: "falah-bookmark", icon: fav ? "star-off" : "star", checked: fav,
					onClick: () => ctx.plugin.bookmarks.setFavourite(anchor, !fav),
				});
				return out;
			},
		},
		{
			id: "tafsir",
			async items(ctx) {
				const tafsirs = (await ctx.plugin.quranData.listResources()).filter((r) => r.type === "tafsir");
				if (!tafsirs.length) return []; // no tafsirs installed → no Tafsir entry
				// Nest the per-tafsir toggles under one "Tafsir" item so the top-level
				// menu stays short and has room for future actions.
				return [{ title: "Tafsir", icon: "scroll-text", submenu: tafsirMenuItems(tafsirs, ctx) }];
			},
		},
		{
			id: "copy",
			items(ctx) {
				const items: VerseMenuItem[] = [
					{
						title: "Copy Arabic",
						section: "falah-copy",
						icon: "copy",
						onClick: () => navigator.clipboard.writeText(ctx.arabic),
					},
				];
				if (ctx.translation) {
					const t = ctx.translation;
					items.push({
						title: "Copy translation",
						section: "falah-copy",
						icon: "copy",
						onClick: () => navigator.clipboard.writeText(t),
					});
					items.push({
						title: "Copy verse (Arabic + translation)",
						section: "falah-copy",
						icon: "copy",
						onClick: () => navigator.clipboard.writeText(`${ctx.arabic}\n\n${t}`),
					});
				}
				return items;
			},
		},
		{
			id: "open-detail",
			items(ctx) {
				const ref: QuranRef = { kind: "quran", surah: ctx.surah, ayah: ctx.ayah };
				return [
					{
						title: "Open in detail view",
						section: "falah-open",
						icon: "book-open",
						onClick: () => ctx.plugin.openDetail(ref),
					},
				];
			},
		},
	];
}

// Bookmarks leaf view: lists saved anchors grouped, degrading gracefully when
// the underlying edition/collection isn't installed. Never fetches verse/tafsir
// text — rows render from stored fields plus an O(1) availability snapshot
// built once per render. Obsidian-runtime module (mirrors QuranReaderView in
// reader.ts), not vitest-importable.

import { ItemView, Menu } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type FalahPlugin from "../main";
import { parseRefUri } from "../ref";
import { resolveRow, type AvailabilitySnapshot } from "./resolve";
import type { Bookmark } from "./schema";

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
		return "Bookmarks";
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
	 *  Listing never fetches verse/tafsir text — only these two id sets. */
	private async snapshot(): Promise<AvailabilitySnapshot> {
		const editions = new Set(
			(await this.plugin.quranData.listResources())
				.filter((r) => r.type === "translation" || r.type === "tafsir")
				.map((r) => r.id)
		);
		const collections = new Set(await this.plugin.installedHadithCollections());
		return { editions, collections };
	}

	private openAnchor(item: Bookmark): void {
		const ref = parseRefUri(item.anchor);
		if (!ref) return;
		if (ref.kind === "quran") void this.plugin.openReader(ref.surah, ref.ayah);
		else this.plugin.openDetail(ref);
	}

	private async render(): Promise<void> {
		const snap = await this.snapshot();
		const groups = this.plugin.bookmarks.list();
		const root = this.contentEl;
		root.empty();
		root.addClass("falah-bookmarks");

		const header = root.createDiv({ cls: "falah-bookmarks-header" });
		header.createEl("h2", { text: "Bookmarks" });
		const unresolvable = groups.flatMap((g) => g.items).filter((item) => !resolveRow(item, snap).anchorOk);
		if (unresolvable.length) {
			const cleanupBtn = header.createEl("button", {
				cls: "falah-bookmarks-cleanup",
				text: `Clean up unresolvable (${unresolvable.length})`,
			});
			cleanupBtn.onclick = () => void this.cleanupUnresolvable(unresolvable);
		}

		const hasAny = groups.some((g) => g.items.length);
		if (!hasAny) {
			root.createDiv({ cls: "falah-bookmarks-empty", text: "No bookmarks yet." });
			return;
		}

		for (const group of groups) {
			if (!group.items.length) continue;
			root.createEl("h3", { text: group.name });
			for (const item of group.items) {
				this.renderRow(root, item, snap);
			}
		}
	}

	private renderRow(root: HTMLElement, item: Bookmark, snap: AvailabilitySnapshot): void {
		const state = resolveRow(item, snap);
		const row = root.createDiv({ cls: "falah-bookmark-row" });
		if (!state.anchorOk) row.addClass("falah-bookmark-row-unresolvable");
		else if (state.lensState === "dormant") row.addClass("falah-bookmark-row-dormant");

		const main = row.createDiv({ cls: "falah-bookmark-main" });
		main.createSpan({ cls: "falah-bookmark-label", text: state.label });
		if (item.note) main.createSpan({ cls: "falah-bookmark-note", text: item.note });
		if (state.badge) main.createSpan({ cls: "falah-bookmark-badge", text: state.badge });
		main.onClickEvent(() => this.openAnchor(item));

		const removeBtn = row.createEl("button", { cls: "falah-bookmark-remove", text: "Remove" });
		removeBtn.onclick = (e) => {
			e.stopPropagation();
			void this.plugin.bookmarks.remove(item.id);
		};

		row.oncontextmenu = (e) => {
			const menu = new Menu();
			menu
				.addItem((mi) =>
					mi
						.setTitle("Remove")
						.setIcon("trash")
						.onClick(() => void this.plugin.bookmarks.remove(item.id))
				);
			menu.showAtMouseEvent(e);
		};
	}

	private async cleanupUnresolvable(items: Bookmark[]): Promise<void> {
		for (const item of items) await this.plugin.bookmarks.remove(item.id);
	}
}

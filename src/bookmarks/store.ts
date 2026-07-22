// Obsidian-agnostic bookmark service over FileIO. Owns the in-memory store,
// persistence, id generation, and change notifications. No "obsidian" import.

import type { FileIO } from "../data/store";
import {
	bookmarkId, emptyStore, parseStore, serializeStore,
	type BookmarkStore, type BookmarkGroup, type Bookmark, type Lens,
} from "./schema";

const DEFAULT_GROUP = "Bookmarks";

export class BookmarkStoreService {
	private store: BookmarkStore = emptyStore();
	private listeners: Array<() => void> = [];

	constructor(
		private io: FileIO,
		private path: string,
		private now: () => number = () => Date.now(),
	) {}

	async load(): Promise<void> {
		this.store = (await this.io.exists(this.path))
			? parseStore(await this.io.read(this.path))
			: emptyStore();
	}

	list(): BookmarkGroup[] {
		return this.store.groups;
	}

	has(anchor: string, lens?: Lens): boolean {
		const id = bookmarkId(anchor, lens);
		return this.store.groups.some((g) => g.items.some((i) => i.id === id));
	}

	ensureGroup(name: string): BookmarkGroup {
		let g = this.store.groups.find((x) => x.name === name);
		if (!g) {
			g = { id: `g-${this.now()}-${this.store.groups.length}`, name, order: this.store.groups.length, items: [] };
			this.store.groups.push(g);
		}
		return g;
	}

	async add(input: { anchor: string; lens?: Lens; note?: string; group?: string }): Promise<Bookmark> {
		const id = bookmarkId(input.anchor, input.lens);
		const existing = this.find(id);
		if (existing) return existing;
		const group = this.ensureGroup(input.group ?? DEFAULT_GROUP);
		const item: Bookmark = { id, anchor: input.anchor, lens: input.lens, note: input.note, added: this.now() };
		group.items.push(item);
		await this.persist();
		return item;
	}

	async remove(id: string): Promise<void> {
		for (const g of this.store.groups) {
			const i = g.items.findIndex((x) => x.id === id);
			if (i >= 0) { g.items.splice(i, 1); await this.persist(); return; }
		}
	}

	onChange(cb: () => void): () => void {
		this.listeners.push(cb);
		return () => {
			const i = this.listeners.indexOf(cb);
			if (i >= 0) this.listeners.splice(i, 1);
		};
	}

	private find(id: string): Bookmark | undefined {
		for (const g of this.store.groups) {
			const item = g.items.find((i) => i.id === id);
			if (item) return item;
		}
		return undefined;
	}

	private async persist(): Promise<void> {
		const dir = this.path.includes("/") ? this.path.slice(0, this.path.lastIndexOf("/")) : "";
		if (dir && !(await this.io.exists(dir))) await this.io.mkdir(dir);
		await this.io.write(this.path, serializeStore(this.store));
		for (const cb of this.listeners) cb();
	}
}

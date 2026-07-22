# Bookmark Collections & Favourites — PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bare bookmarks view into a real organizer — user-created **collections** (management UI on the existing `groups`), a cross-cutting **favourite** star, a quick-save+submenu interaction, and a **Bookmarks settings** section.

**Architecture:** Extends the shipped bookmarks feature. Additive schema change (`favourite` flag + `BOOKMARKS_VERSION` 1→2). New store methods for collection management and favourites. Verse/detail menus gain a "Bookmark to ▸" submenu + favourite toggle. The leaf view is rewritten to render a ★ Favourites section + collapsible, manageable collections. New surfaces route through `t()` (en+ar) and get theme-aware CSS. API bumps 5→6.

**Tech Stack:** TypeScript, Obsidian plugin API, vitest. Builds on `src/bookmarks/{schema,store,resolve,view}.ts`, `src/verse-actions.ts`, `src/detail.ts`, `src/main.ts`, `src/api.ts`, `src/i18n/`, `styles.css`.

Spec: [`../specs/2026-07-22-bookmark-collections-design.md`](../specs/2026-07-22-bookmark-collections-design.md) (this plan is **PR1** only; Recent/last-read is PR2).

## Global Constraints

- **No new runtime dependencies.** Stdlib + already-installed only.
- **Pure modules import no `obsidian` runtime:** `schema.ts`, `store.ts`, `resolve.ts`, `sort.ts` use `import type` only (vitest-importable). `store.ts` uses only the `FileIO` interface.
- **Never lose a bookmark.** Deleting a collection **moves its items into the default collection**; it never deletes bookmarks. The default collection (`"Bookmarks"`) can't be deleted.
- **Favourite is a flag, not a collection.** A favourited item appears in both the ★ Favourites section and its home collection.
- **Identity stays the `falah://` anchor** via `ref.ts`; a bookmark's `id` (`bookmarkId(anchor, lens)`) is globally unique — an anchor lives in exactly one collection.
- **Store persists on every intentional mutation, then fires `onChange`.** Listing never fetches verse text.
- **Falah depends on no other plugin.** Nothing imports Tadabbur; the deliberate-Tadabbur-reference count (`grep -rc "TADABBUR\|Tadabbur\|tadabbur" src/` summed) must stay **11**.
- **`FALAH_API_VERSION` becomes exactly `6`.** Additive only — no existing API member changed.
- New user-facing strings route through `t()` with en + ar keys; new view classes get theme-aware CSS using Obsidian's native variables (no new `--falah-*` Style Settings vars).
- Gate: `npm test`, `npm run lint` (0 errors), `npm run build` all pass.

## File Structure

- Modify `src/bookmarks/schema.ts` — add `favourite?` to `Bookmark`; bump version.
- Modify `src/bookmarks/schema.test.ts`
- Modify `src/bookmarks/store.ts` — collection ops + favourites + sorted `list()`.
- Modify `src/bookmarks/store.test.ts`
- Create `src/bookmarks/sort.ts` — pure `sortBookmarks(items, mode)`.
- Create `src/bookmarks/sort.test.ts`
- Create `src/bookmarks/prompt.ts` — minimal name-prompt modal (obsidian).
- Modify `src/api.ts` — 4 new bookmark methods, bump to 6.
- Modify `src/api.test.ts`
- Modify `src/main.ts` — settings fields + Bookmarks settings section; new-collection plugin method; API wiring.
- Modify `src/verse-actions.ts` — quick-save + "Bookmark to ▸" submenu + favourite toggle.
- Modify `src/verse-actions.test.ts`
- Modify `src/detail.ts` — favourite toggle button.
- Modify `src/bookmarks/view.ts` — Favourites section + collapsible, manageable collections + sort.
- Modify `src/i18n/en.ts`, `src/i18n/ar.ts` — new keys.
- Modify `styles.css` — styles for the new view elements.

---

### Task 1: Schema — favourite flag + version bump

**Files:** Modify `src/bookmarks/schema.ts`, `src/bookmarks/schema.test.ts`

**Interfaces:**
- Produces: `Bookmark` gains `favourite?: boolean`; `BOOKMARKS_VERSION = 2`.

- [ ] **Step 1: Write the failing test** — add to `src/bookmarks/schema.test.ts`:

```ts
import { BOOKMARKS_VERSION, serializeStore, parseStore } from "./schema";
import { describe, it, expect } from "vitest";

describe("schema v2 favourite", () => {
	it("BOOKMARKS_VERSION is 2", () => {
		expect(BOOKMARKS_VERSION).toBe(2);
	});
	it("favourite round-trips and is optional", () => {
		const store = {
			version: BOOKMARKS_VERSION,
			groups: [{ id: "g1", name: "Bookmarks", order: 0, items: [
				{ id: "a", anchor: "falah://quran/2/255", added: 1, favourite: true },
				{ id: "b", anchor: "falah://quran/1/1", added: 2 },
			] }],
		};
		const back = parseStore(serializeStore(store));
		expect(back.groups[0].items[0].favourite).toBe(true);
		expect(back.groups[0].items[1].favourite).toBeUndefined();
	});
	it("a v1 store (no favourite) still parses", () => {
		const v1 = '{"version":1,"groups":[{"id":"g","name":"Bookmarks","order":0,"items":[{"id":"a","anchor":"falah://quran/1/1","added":1}]}]}';
		const back = parseStore(v1);
		expect(back.groups[0].items[0].favourite).toBeUndefined();
		expect(back.version).toBe(1); // preserved; a future breaking change can detect it
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/schema.test.ts`
Expected: FAIL — `BOOKMARKS_VERSION` is still 1.

- [ ] **Step 3: Write minimal implementation** — in `src/bookmarks/schema.ts`:
  1. Add `favourite?: boolean;` to the `Bookmark` interface (after `added: number;`).
  2. Change `export const BOOKMARKS_VERSION = 1;` to `= 2;`.

(No `parseStore` change needed — it copies groups/items through unchanged, so `favourite` survives and its absence stays `undefined`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/schema.ts src/bookmarks/schema.test.ts
git commit -m "feat(bookmarks): add favourite flag, bump store version to 2"
```

---

### Task 2: Store — collection management + sorted list

**Files:** Modify `src/bookmarks/store.ts`, `src/bookmarks/store.test.ts`

**Interfaces:**
- Consumes: `BookmarkGroup`, `Bookmark` (schema).
- Produces on `BookmarkStoreService`:
  - `list(): BookmarkGroup[]` — now returns groups **sorted by `order`**.
  - `createGroup(name: string): Promise<BookmarkGroup>`
  - `renameGroup(id: string, name: string): Promise<void>`
  - `deleteGroup(id: string): Promise<void>` — moves items to default, then removes; refuses to delete the default group.
  - `moveItem(itemId: string, toGroupId: string): Promise<void>`
  - `setGroupOrder(orderedIds: string[]): Promise<void>`
  - `DEFAULT_GROUP` exported as `DEFAULT_BOOKMARK_GROUP`.

- [ ] **Step 1: Write the failing test** — add to `src/bookmarks/store.test.ts` (reuse the file's existing `memIO` helper and `beforeEach` service setup):

```ts
describe("collection management", () => {
	it("list() returns groups sorted by order", async () => {
		await svc.createGroup("B");
		await svc.createGroup("A");
		await svc.setGroupOrder([svc.list().find(g => g.name === "A")!.id, svc.list().find(g => g.name === "B")!.id]);
		expect(svc.list().map(g => g.name)).toEqual(["A", "B"]);
	});
	it("createGroup reuses an existing name, persists", async () => {
		const a = await svc.createGroup("Juz Amma");
		const b = await svc.createGroup("Juz Amma");
		expect(a.id).toBe(b.id);
		expect(svc.list().filter(g => g.name === "Juz Amma")).toHaveLength(1);
	});
	it("renameGroup changes the name", async () => {
		const g = await svc.createGroup("Old");
		await svc.renameGroup(g.id, "New");
		expect(svc.list().find(x => x.id === g.id)!.name).toBe("New");
	});
	it("deleteGroup moves its items into the default group, never deletes them", async () => {
		const g = await svc.createGroup("Juz Amma");
		await svc.add({ anchor: "falah://quran/112/1", group: "Juz Amma" });
		await svc.deleteGroup(g.id);
		expect(svc.list().some(x => x.name === "Juz Amma")).toBe(false);
		expect(svc.has("falah://quran/112/1")).toBe(true);
		expect(svc.list().find(x => x.name === "Bookmarks")!.items.map(i => i.anchor)).toContain("falah://quran/112/1");
	});
	it("deleteGroup refuses to delete the default group", async () => {
		await svc.add({ anchor: "falah://quran/1/1" }); // creates default
		const def = svc.list().find(g => g.name === "Bookmarks")!;
		await svc.deleteGroup(def.id);
		expect(svc.list().some(g => g.name === "Bookmarks")).toBe(true);
	});
	it("moveItem reassigns a bookmark to another collection", async () => {
		const b = await svc.add({ anchor: "falah://quran/2/255" });
		const target = await svc.createGroup("Duas");
		await svc.moveItem(b.id, target.id);
		expect(svc.list().find(g => g.name === "Bookmarks")!.items).toHaveLength(0);
		expect(svc.list().find(g => g.id === target.id)!.items.map(i => i.anchor)).toContain("falah://quran/2/255");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/store.test.ts`
Expected: FAIL — `createGroup`/etc. undefined.

- [ ] **Step 3: Write minimal implementation** — in `src/bookmarks/store.ts`:

Export the default name and sort `list()`:
```ts
export const DEFAULT_BOOKMARK_GROUP = "Bookmarks";
```
(replace the private `const DEFAULT_GROUP = "Bookmarks";` usages with `DEFAULT_BOOKMARK_GROUP`.)

```ts
	list(): BookmarkGroup[] {
		return [...this.store.groups].sort((a, b) => a.order - b.order);
	}

	async createGroup(name: string): Promise<BookmarkGroup> {
		const g = this.ensureGroup(name);
		await this.persist();
		return g;
	}

	async renameGroup(id: string, name: string): Promise<void> {
		const g = this.store.groups.find((x) => x.id === id);
		if (!g) return;
		g.name = name;
		await this.persist();
	}

	async deleteGroup(id: string): Promise<void> {
		const idx = this.store.groups.findIndex((g) => g.id === id);
		if (idx < 0) return;
		const group = this.store.groups[idx];
		if (group.name === DEFAULT_BOOKMARK_GROUP) return; // default is undeletable
		const def = this.ensureGroup(DEFAULT_BOOKMARK_GROUP);
		def.items.push(...group.items);                    // move, never delete
		this.store.groups.splice(this.store.groups.indexOf(group), 1);
		await this.persist();
	}

	async moveItem(itemId: string, toGroupId: string): Promise<void> {
		const target = this.store.groups.find((g) => g.id === toGroupId);
		if (!target) return;
		for (const g of this.store.groups) {
			const i = g.items.findIndex((x) => x.id === itemId);
			if (i >= 0) {
				if (g.id === toGroupId) return;
				const [item] = g.items.splice(i, 1);
				target.items.push(item);
				await this.persist();
				return;
			}
		}
	}

	async setGroupOrder(orderedIds: string[]): Promise<void> {
		orderedIds.forEach((id, i) => {
			const g = this.store.groups.find((x) => x.id === id);
			if (g) g.order = i;
		});
		await this.persist();
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/store.test.ts`
Expected: PASS (existing store tests still green — `list()` order is stable for insertion-ordered groups).

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/store.ts src/bookmarks/store.test.ts
git commit -m "feat(bookmarks): collection management (create/rename/delete/move/order)"
```

---

### Task 3: Store — favourites

**Files:** Modify `src/bookmarks/store.ts`, `src/bookmarks/store.test.ts`

**Interfaces:**
- Produces on `BookmarkStoreService`:
  - `isFavourite(anchor: string, lens?: Lens): boolean`
  - `setFavourite(anchor: string, on: boolean, lens?: Lens): Promise<void>` — if turning on an anchor that isn't bookmarked yet, creates it in the default group first; turning off keeps the bookmark.
  - `favourites(): Bookmark[]` — all flagged items across groups (natural order; the view sorts).

- [ ] **Step 1: Write the failing test** — add to `src/bookmarks/store.test.ts`:

```ts
describe("favourites", () => {
	it("setFavourite(on) on a new anchor creates a bookmark in default and flags it", async () => {
		await svc.setFavourite("falah://quran/2/255", true);
		expect(svc.isFavourite("falah://quran/2/255")).toBe(true);
		expect(svc.list().find(g => g.name === "Bookmarks")!.items[0].favourite).toBe(true);
		expect(svc.favourites().map(i => i.anchor)).toEqual(["falah://quran/2/255"]);
	});
	it("setFavourite(off) keeps the bookmark, clears the flag", async () => {
		const b = await svc.add({ anchor: "falah://quran/1/1", group: "Duas" });
		await svc.setFavourite(b.anchor, true);
		await svc.setFavourite(b.anchor, false);
		expect(svc.isFavourite(b.anchor)).toBe(false);
		expect(svc.has(b.anchor)).toBe(true); // still bookmarked
		expect(svc.favourites()).toHaveLength(0);
	});
	it("setFavourite(off) on a non-bookmarked anchor is a no-op (creates nothing)", async () => {
		await svc.setFavourite("falah://quran/9/9", false);
		expect(svc.has("falah://quran/9/9")).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/store.test.ts`
Expected: FAIL — `setFavourite` undefined.

- [ ] **Step 3: Write minimal implementation** — in `src/bookmarks/store.ts`:

```ts
	isFavourite(anchor: string, lens?: Lens): boolean {
		return this.find(bookmarkId(anchor, lens))?.favourite === true;
	}

	async setFavourite(anchor: string, on: boolean, lens?: Lens): Promise<void> {
		let item = this.find(bookmarkId(anchor, lens));
		if (!item) {
			if (!on) return;                       // nothing to unfavourite
			item = await this.add({ anchor, lens }); // create in default, then flag
		}
		item.favourite = on;
		await this.persist();
	}

	favourites(): Bookmark[] {
		return this.store.groups.flatMap((g) => g.items).filter((i) => i.favourite);
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/store.ts src/bookmarks/store.test.ts
git commit -m "feat(bookmarks): favourite flag store methods"
```

---

### Task 4: Sort helper (pure)

**Files:** Create `src/bookmarks/sort.ts`, `src/bookmarks/sort.test.ts`

**Interfaces:**
- Consumes: `Bookmark` (schema); `parseRefUri` from `../ref`.
- Produces: `BookmarkSort = "added" | "manual" | "surah"`; `sortBookmarks(items: Bookmark[], mode: BookmarkSort): Bookmark[]` — returns a NEW array; `manual` preserves input order.

- [ ] **Step 1: Write the failing test** — `src/bookmarks/sort.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sortBookmarks } from "./sort";
import type { Bookmark } from "./schema";

const b = (anchor: string, added: number): Bookmark => ({ id: anchor, anchor, added });
const items = [
	b("falah://quran/2/255", 30),
	b("falah://quran/1/1", 10),
	b("falah://quran/1/5", 20),
];

describe("sortBookmarks", () => {
	it("added: newest first", () => {
		expect(sortBookmarks(items, "added").map(x => x.added)).toEqual([30, 20, 10]);
	});
	it("surah: by surah then ayah", () => {
		expect(sortBookmarks(items, "surah").map(x => x.anchor)).toEqual([
			"falah://quran/1/1", "falah://quran/1/5", "falah://quran/2/255",
		]);
	});
	it("manual: input order preserved, new array", () => {
		const out = sortBookmarks(items, "manual");
		expect(out).not.toBe(items);
		expect(out.map(x => x.added)).toEqual([30, 10, 20]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/sort.test.ts`
Expected: FAIL — cannot resolve `./sort`.

- [ ] **Step 3: Write minimal implementation** — `src/bookmarks/sort.ts`:

```ts
// Pure bookmark ordering for the view. No "obsidian" import.
import { parseRefUri } from "../ref";
import type { Bookmark } from "./schema";

export type BookmarkSort = "added" | "manual" | "surah";

/** Returns a new array. "manual" preserves stored order. */
export function sortBookmarks(items: Bookmark[], mode: BookmarkSort): Bookmark[] {
	const out = [...items];
	if (mode === "added") out.sort((a, b) => b.added - a.added);
	else if (mode === "surah") out.sort((a, b) => surahKey(a) - surahKey(b));
	return out;
}

/** Sortable numeric key: quran surah*1000+ayah; hadith/unparseable sort last, stably. */
function surahKey(item: Bookmark): number {
	const ref = parseRefUri(item.anchor);
	if (ref?.kind === "quran") return ref.surah * 1000 + ref.ayah;
	return Number.MAX_SAFE_INTEGER;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/sort.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/sort.ts src/bookmarks/sort.test.ts
git commit -m "feat(bookmarks): pure sort helper (added/manual/surah)"
```

---

### Task 5: API v6

**Files:** Modify `src/api.ts`, `src/api.test.ts`, `src/main.ts`

**Interfaces:**
- Consumes: store methods from Tasks 2–3.
- Produces on `FalahBookmarksApi`: `setFavourite(anchor, on, lens?)`, `favourites()`, `createCollection(name)`, `moveItem(id, toGroupId)`; `FALAH_API_VERSION = 6`.

- [ ] **Step 1: Write the failing test** — update the version assertion in `src/api.test.ts`:

```ts
it("version is 6", () => { expect(FALAH_API_VERSION).toBe(6); });
```
(replace the existing `toBe(5)` assertion).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api.test.ts`
Expected: FAIL — version is 5.

- [ ] **Step 3: Write minimal implementation**

In `src/api.ts`:
1. `export const FALAH_API_VERSION = 6;`
2. Extend `FalahBookmarksApi` (additive):
```ts
	/** Set/clear the favourite flag; creates the bookmark in the default collection if needed. Added in v6. */
	setFavourite(anchor: string, on: boolean, lens?: Lens): Promise<void>;
	/** All favourited bookmarks. Added in v6. */
	favourites(): Bookmark[];
	/** Create (or reuse) a collection by name. Added in v6. */
	createCollection(name: string): Promise<BookmarkGroup>;
	/** Move a bookmark into another collection. Added in v6. */
	moveItem(id: string, toGroupId: string): Promise<void>;
```

In `src/main.ts`, extend the `bookmarks: { … }` object in the `this.api` literal:
```ts
				setFavourite: (anchor, on, lens) => this.bookmarks.setFavourite(anchor, on, lens),
				favourites: () => this.bookmarks.favourites(),
				createCollection: (name) => this.bookmarks.createGroup(name),
				moveItem: (id, toGroupId) => this.bookmarks.moveItem(id, toGroupId),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api.test.ts` then `npm run build`
Expected: test PASS; build passes (confirms the store method signatures match).

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/api.test.ts src/main.ts
git commit -m "feat(api): bookmarks favourites + collections, bump FALAH_API_VERSION to 6"
```

> **Cross-repo reminder (do NOT edit Tadabbur here):** when Tadabbur adopts v6, bump its `REQUIRED_FALAH_API` and `src/falah-api.d.ts` mirror to 6. Grep both repos — no CI pins this.

---

### Task 6: Settings — Bookmarks section

**Files:** Modify `src/main.ts`, `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Produces: `FalahSettings` gains `bookmarkDefaultCollection: string` (default `"Bookmarks"`), `bookmarkShowFavourites: boolean` (default `true`), `bookmarkSort: BookmarkSort` (default `"added"`). New i18n keys.

- [ ] **Step 1: Add the settings fields**

In `src/main.ts`:
1. Import the sort type: add `import type { BookmarkSort } from "./bookmarks/sort";`
2. In the `FalahSettings` interface add:
```ts
	bookmarkDefaultCollection: string;
	bookmarkShowFavourites: boolean;
	bookmarkSort: BookmarkSort;
```
3. In `DEFAULT_SETTINGS` add:
```ts
	bookmarkDefaultCollection: "Bookmarks",
	bookmarkShowFavourites: true,
	bookmarkSort: "added",
```

- [ ] **Step 2: Add i18n keys**

In `src/i18n/en.ts` (Bookmarks section):
```ts
	setHeadingBookmarks: "Bookmarks",
	setBookmarkDefaultCollectionName: "Default collection",
	setBookmarkDefaultCollectionDesc: "New bookmarks go here unless you pick another collection.",
	setBookmarkShowFavouritesName: "Show favourites section",
	setBookmarkShowFavouritesDesc: "Pin a ★ Favourites section at the top of the bookmarks view.",
	setBookmarkSortName: "Sort bookmarks by",
	sortAddedLabel: "Recently added",
	sortManualLabel: "Manual order",
	sortSurahLabel: "Surah order",
```
In `src/i18n/ar.ts` (short labels only, rest falls back):
```ts
	setHeadingBookmarks: "العلامات المرجعية",
	setBookmarkDefaultCollectionName: "المجموعة الافتراضية",
	setBookmarkShowFavouritesName: "إظهار قسم المفضلة",
	setBookmarkSortName: "ترتيب العلامات المرجعية حسب",
	sortAddedLabel: "المُضافة حديثًا",
	sortManualLabel: "ترتيب يدوي",
	sortSurahLabel: "ترتيب السور",
```

- [ ] **Step 3: Add the Bookmarks settings section**

In `FalahSettingTab.display()` (in `src/main.ts`), add a heading + controls. Place the **existing** `setBookmarksPathName` field under this heading (move it here if it currently sits elsewhere). Match the style of the surrounding `new Setting(containerEl)` blocks:

```ts
		new Setting(containerEl).setName(t().setHeadingBookmarks).setHeading();

		new Setting(containerEl)
			.setName(t().setBookmarkDefaultCollectionName)
			.setDesc(t().setBookmarkDefaultCollectionDesc)
			.addDropdown((d) => {
				const names = Array.from(new Set([
					"Bookmarks",
					...this.plugin.bookmarks.list().map((g) => g.name),
				]));
				for (const n of names) d.addOption(n, n);
				d.setValue(this.plugin.settings.bookmarkDefaultCollection);
				d.onChange(async (v) => {
					this.plugin.settings.bookmarkDefaultCollection = v || "Bookmarks";
					await this.plugin.persist();
				});
			});

		new Setting(containerEl)
			.setName(t().setBookmarkShowFavouritesName)
			.setDesc(t().setBookmarkShowFavouritesDesc)
			.addToggle((tg) => tg
				.setValue(this.plugin.settings.bookmarkShowFavourites)
				.onChange(async (v) => {
					this.plugin.settings.bookmarkShowFavourites = v;
					await this.plugin.persist();
				}));

		new Setting(containerEl)
			.setName(t().setBookmarkSortName)
			.addDropdown((d) => {
				d.addOption("added", t().sortAddedLabel);
				d.addOption("manual", t().sortManualLabel);
				d.addOption("surah", t().sortSurahLabel);
				d.setValue(this.plugin.settings.bookmarkSort);
				d.onChange(async (v) => {
					this.plugin.settings.bookmarkSort = v as BookmarkSort;
					await this.plugin.persist();
				});
			});
		// (existing "Bookmarks file" path setting: keep it, placed under this heading)
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build` then `npm test`
Expected: both pass. Manually: open Settings → the Bookmarks section shows the default-collection dropdown, favourites toggle, sort dropdown, and file path.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(bookmarks): Bookmarks settings section (default collection, favourites, sort)"
```

---

### Task 7: Name-prompt modal + interactions (verse action & detail)

**Files:** Create `src/bookmarks/prompt.ts`; modify `src/verse-actions.ts`, `src/verse-actions.test.ts`, `src/detail.ts`, `src/main.ts`

**Interfaces:**
- Produces:
  - `promptName(app: App, title: string, initial?: string): Promise<string | null>` in `prompt.ts` (obsidian modal; resolves the entered name, or null if cancelled).
  - `FalahPlugin.newCollectionFor(anchor: string, lens?: Lens): Promise<void>` — prompts for a name, creates the collection, adds the bookmark to it.
  - verse `bookmark` action returns quick-toggle + "Bookmark to ▸" submenu + favourite toggle.
  - detail modal gains a favourite (★) toggle beside the Bookmark button.

- [ ] **Step 1: Create the prompt modal** — `src/bookmarks/prompt.ts`:

```ts
import { App, Modal, Setting } from "obsidian";

/** Minimal single-field name prompt. Resolves the trimmed value, or null if
 *  cancelled/empty. Obsidian has no built-in prompt, so this is the shared one. */
export function promptName(app: App, title: string, initial = ""): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		let value = initial;
		let submitted = false;
		modal.titleEl.setText(title);
		new Setting(modal.contentEl).addText((t) => {
			t.setValue(initial).onChange((v) => (value = v));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { submitted = true; modal.close(); }
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(modal.contentEl).addButton((b) =>
			b.setButtonText("Create").setCta().onClick(() => { submitted = true; modal.close(); })
		);
		modal.onClose = () => resolve(submitted && value.trim() ? value.trim() : null);
		modal.open();
	});
}
```

- [ ] **Step 2: Add the plugin method** — in `src/main.ts`:

```ts
	async newCollectionFor(anchor: string, lens?: Lens): Promise<void> {
		const name = await promptName(this.app, t().bookmarkNewCollectionPrompt);
		if (!name) return;
		await this.bookmarks.createGroup(name);
		await this.bookmarks.add({ anchor, lens, group: name });
	}
```
Add imports: `import { promptName } from "./bookmarks/prompt";` and `import type { Lens } from "./bookmarks/schema";` (if not already imported). Add the i18n key `bookmarkNewCollectionPrompt: "New collection name"` to `en.ts` (ar optional).

- [ ] **Step 3: Write the failing test for the verse action** — replace the existing "bookmark verse action" test in `src/verse-actions.test.ts` with one covering the new shape:

```ts
describe("bookmark verse action", () => {
	function ctxWith(over: Record<string, unknown>) {
		return {
			surah: 2, ayah: 255, ayahKey: "2:255", arabic: "…",
			plugin: {
				settings: { bookmarkDefaultCollection: "Bookmarks" },
				newCollectionFor: async () => {},
				bookmarks: {
					has: () => false, isFavourite: () => false,
					add: async () => {}, remove: async () => {}, setFavourite: async () => {},
					list: () => [{ id: "g1", name: "Juz Amma", order: 0, items: [] }],
					...over,
				},
			},
		} as unknown as VerseContext;
	}
	it("unsaved: offers quick-bookmark, a Bookmark-to submenu of collections + New, and a favourite toggle", async () => {
		const added: Array<{ anchor: string; group?: string }> = [];
		const action = defaultVerseActions().find((a) => a.id === "bookmark")!;
		const items = await action.items(ctxWith({ add: async (i: { anchor: string; group?: string }) => { added.push(i); } }));
		const titles = items.map((i) => i.title);
		expect(titles.some((t) => /bookmark verse/i.test(t))).toBe(true);
		const submenu = items.find((i) => i.submenu)!.submenu!;
		expect(submenu.map((s) => s.title)).toEqual(expect.arrayContaining(["Juz Amma"]));
		expect(submenu.some((s) => /new collection/i.test(s.title))).toBe(true);
		await items.find((i) => i.title.match(/bookmark verse/i))!.onClick!();
		expect(added[0]).toEqual({ anchor: "falah://quran/2/255", group: "Bookmarks" });
		expect(items.some((i) => /favourit/i.test(i.title))).toBe(true);
	});
	it("saved: offers remove + favourite toggle", async () => {
		const action = defaultVerseActions().find((a) => a.id === "bookmark")!;
		const items = await action.items(ctxWith({ has: () => true }));
		expect(items.some((i) => /remove bookmark/i.test(i.title))).toBe(true);
		expect(items.some((i) => /favourit/i.test(i.title))).toBe(true);
	});
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/verse-actions.test.ts`
Expected: FAIL — the action still returns the single old item.

- [ ] **Step 5: Rewrite the `bookmark` verse action** — in `src/verse-actions.ts`, replace the `id: "bookmark"` action's `items(ctx)`:

```ts
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
```
Add `VerseMenuItem` to the type imports at the top of `verse-actions.ts` if not already imported (it's declared in this file, so just reference it).

> The `VerseContext.plugin` type is `FalahPlugin`; `settings`, `bookmarks.isFavourite/setFavourite/list`, and `newCollectionFor` all exist on it after Tasks 2/3/6 and Step 2. No `any`.

- [ ] **Step 6: Add the detail favourite toggle** — in `src/detail.ts`, in the `bookmarkButton(container)` helper (or beside it), add a ★ button:

```ts
		const favBtn = container.createEl("button", {
			text: this.plugin.bookmarks.isFavourite(anchor) ? "★" : "☆",
			attr: { "aria-label": "Toggle favourite" },
		});
		favBtn.onclick = async () => {
			await this.plugin.bookmarks.setFavourite(anchor, !this.plugin.bookmarks.isFavourite(anchor));
			favBtn.setText(this.plugin.bookmarks.isFavourite(anchor) ? "★" : "☆");
		};
```
(Place it right after the existing Bookmark button in the same container.)

- [ ] **Step 7: Verify**

Run: `npx vitest run src/verse-actions.test.ts` (PASS), then `npm test`, `npm run lint`, `npm run build` (all pass). Manually: the ayah menu shows Bookmark verse + Bookmark to ▸ (collections + New collection…) + favourite toggle; New collection… prompts and files the bookmark there.

- [ ] **Step 8: Commit**

```bash
git add src/bookmarks/prompt.ts src/verse-actions.ts src/verse-actions.test.ts src/detail.ts src/main.ts src/i18n/en.ts
git commit -m "feat(bookmarks): quick-save+submenu, New collection prompt, favourite toggles"
```

---

### Task 8: Bookmarks view — Favourites section + manageable collections

**Files:** Modify `src/bookmarks/view.ts`, `src/i18n/en.ts`, `src/i18n/ar.ts`, `styles.css`

**Interfaces:**
- Consumes: store methods (Tasks 2–3), `sortBookmarks` (Task 4), `promptName` (Task 7), settings (Task 6).

This is Obsidian-runtime glue (build-gated, no unit test). Rewrite `render()` to produce, top to bottom:

1. **★ Favourites** — only if `settings.bookmarkShowFavourites` and `bookmarks.favourites().length`. A header + rows from `sortBookmarks(bookmarks.favourites(), settings.bookmarkSort)`.
2. **Collections** — a top **＋ New collection** button (`promptName` → `bookmarks.createGroup`). For each `group` of `bookmarks.list()` (already order-sorted): a header row with the name, item count, a collapse toggle (click header → toggle `group.collapsed` via a new `bookmarks.setCollapsed(id, bool)` — add this trivial persist method to the store, or reuse `renameGroup`-style; see note), and a "⋯" menu (Rename → `promptName`+`renameGroup`; Delete → `deleteGroup`; unless it's the default "Bookmarks"). When not collapsed, rows from `sortBookmarks(group.items, settings.bookmarkSort)`.

Each **row** (shared helper) shows: a **star** toggle (filled when favourite → `setFavourite(anchor, !isFavourite)`), the label/note/badge (existing `resolveRow` + `badgeText`), click-to-open (existing `openAnchor`), and a context menu with **Move to ▸** (list other collections → `moveItem(item.id, group.id)`) and **Remove** (existing).

- [ ] **Step 1: Add `setCollapsed` to the store** — in `src/bookmarks/store.ts` add and cover with a one-line test in `store.test.ts`:
```ts
	async setCollapsed(id: string, collapsed: boolean): Promise<void> {
		const g = this.store.groups.find((x) => x.id === id);
		if (!g) return;
		g.collapsed = collapsed;
		await this.persist();
	}
```
Test: create a group, `setCollapsed(id, true)`, assert `list().find(...).collapsed === true`.

- [ ] **Step 2: Add i18n keys** — `en.ts`:
```ts
	bookmarksFavouritesHeading: "★ Favourites",
	bookmarksNewCollection: "New collection",
	bookmarksRenameCollection: "Rename collection",
	bookmarksDeleteCollection: "Delete collection",
	bookmarkMoveTo: "Move to",
	bookmarkFavourite: "Favourite",
	bookmarkUnfavourite: "Unfavourite",
```
`ar.ts` (short labels):
```ts
	bookmarksNewCollection: "مجموعة جديدة",
	bookmarksRenameCollection: "إعادة تسمية المجموعة",
	bookmarksDeleteCollection: "حذف المجموعة",
	bookmarkMoveTo: "نقل إلى",
```

- [ ] **Step 3: Rewrite `render()`** in `src/bookmarks/view.ts`. Replace the current single-group render with the sections above. Key structure (import `sortBookmarks`, `promptName`, `Menu` already imported):

```ts
	private async render(): Promise<void> {
		const snap = await this.snapshot();
		const bm = this.plugin.bookmarks;
		const sort = this.plugin.settings.bookmarkSort;
		const root = this.contentEl;
		root.empty();
		root.addClass("falah-bookmarks");

		root.createEl("h2", { text: t().bookmarksViewTitle });

		// New collection
		const newBtn = root.createEl("button", { cls: "falah-bookmarks-new", text: `＋ ${t().bookmarksNewCollection}` });
		newBtn.onclick = async () => {
			const name = await promptName(this.app, t().bookmarksNewCollection);
			if (name) await bm.createGroup(name);
		};

		// ★ Favourites
		if (this.plugin.settings.bookmarkShowFavourites && bm.favourites().length) {
			root.createEl("h3", { cls: "falah-bookmarks-favourites-head", text: t().bookmarksFavouritesHeading });
			for (const item of sortBookmarks(bm.favourites(), sort)) this.renderRow(root, item, snap);
		}

		// Collections
		for (const group of bm.list()) {
			this.renderCollection(root, group, snap, sort);
		}
	}
```
`renderCollection(root, group, snap, sort)` builds a collapsible header (name + `(${group.items.length})` + ⋯ menu with Rename/Delete unless default), toggles `bm.setCollapsed(group.id, !group.collapsed)` on header click, and renders `sortBookmarks(group.items, sort)` rows when `!group.collapsed`. `renderRow` gains a leading star button:
```ts
		const star = row.createEl("button", { cls: "falah-bookmark-star", text: bm.isFavourite(item.anchor, item.lens) ? "★" : "☆" });
		star.onclick = (e) => { e.stopPropagation(); void bm.setFavourite(item.anchor, !bm.isFavourite(item.anchor, item.lens), item.lens); };
```
and its context menu gains a **Move to ▸** submenu built from `bm.list()` (excluding the current group), each calling `bm.moveItem(item.id, g.id)`.

*(Collection drag-reorder is intentionally deferred to a follow-up — move-via-menu covers organizing; drag is polish. Note it in the commit body.)*

- [ ] **Step 4: Add CSS** — append to `styles.css` (theme-aware, Obsidian native vars), styling: `.falah-bookmarks-new` (subtle full-width button), `.falah-bookmarks-favourites-head`, `.falah-bookmark-star` (unstyled star button, `var(--text-accent)` when filled), collection headers (clickable, `.falah-bookmark-collection-head` with a collapse chevron and the ⋯ menu button), collapsed state, and the count. Match the existing `.falah-bookmark-*` rules added for the shipped view.

- [ ] **Step 5: Verify**

Run: `npm test` (store `setCollapsed` test + all prior pass), `npm run lint` (0 errors), `npm run build` (passes). Manually: create a collection, bookmark into it, favourite an item (appears in ★ Favourites AND its collection), collapse/expand a collection, rename + delete a collection (its items land back in Bookmarks), move an item between collections, change the sort setting and see rows reorder.

- [ ] **Step 6: Commit**

```bash
git add src/bookmarks/view.ts src/bookmarks/store.ts src/bookmarks/store.test.ts src/i18n/en.ts src/i18n/ar.ts styles.css
git commit -m "feat(bookmarks): view with favourites section + manageable collections"
```

---

### Task 9: Full green + invariant recheck

**Files:** none (verification).

- [ ] **Step 1: Full gate**

Run: `npm test && npm run lint && npm run build`
Expected: all pass (lint 0 errors).

- [ ] **Step 2: Invariants**

```bash
grep -rc "TADABBUR\|Tadabbur\|tadabbur" src/ | grep -v ':0' | awk -F: '{s+=$2} END {print s}'   # expect 11
grep -n "FALAH_API_VERSION = " src/api.ts                                                        # expect 6
```

- [ ] **Step 3: Manual acceptance (from the spec, PR1 scope)**

- Create/rename/delete collections; deleting moves items to Bookmarks (no bookmark lost).
- Quick-bookmark → default collection; "Bookmark to ▸" files into a chosen/new collection.
- Favourite a verse from the ayah menu and the detail view; it appears in ★ Favourites and stays in its collection; unfavourite keeps the bookmark.
- Default-collection / show-favourites / sort settings all take effect.
- Everything persists across reload; bookmarks.json holds `version: 2` + `favourite` flags.

- [ ] **Step 4: Finish**

Commit any fixes, then use the finishing-a-development-branch skill to open the PR / merge.

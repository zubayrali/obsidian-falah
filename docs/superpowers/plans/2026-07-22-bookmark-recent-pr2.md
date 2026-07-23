# Bookmark Recent / Last-Read — PR2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-track the last N places the user read as a separate **Recent** list — stored apart from intentional bookmarks, updated on explicit navigation, persisted debounced, surfaced as a Recent section in the bookmarks view.

**Architecture:** Additive to the shipped collections/favourites feature (PR1). A `recent: RecentEntry[]` list on the store (separate from `groups`), capped and deduped, updated in memory on navigation and written to disk **debounced** (+ flushed on reader close and plugin unload). A reader-navigation hook records anchors. A new Recent section in the view. This is the front-half of the Reading Progress roadmap story — scroll-position/current-ayah tracking is NOT in scope.

**Tech Stack:** TypeScript, Obsidian plugin API, vitest. Builds on `src/bookmarks/{schema,store,view}.ts`, `src/main.ts`, `src/reader.ts`, `src/i18n/`, `styles.css`.

Spec: [`../specs/2026-07-22-bookmark-collections-design.md`](../specs/2026-07-22-bookmark-collections-design.md) — this plan is **PR2** (Recent/last-read); PR1 (collections/favourites/settings) already shipped.

## Global Constraints

- **No new runtime dependencies.** Stdlib only (`setTimeout`/`clearTimeout` are fine — no `obsidian` import needed for debounce).
- **Pure/agnostic modules stay obsidian-free:** `schema.ts` (pure), `store.ts` (FileIO + stdlib only).
- **Recent is a SEPARATE list**, never mixed into `groups`; a `RecentEntry` is not a `Bookmark` (no note/lens/collection).
- **Recent persistence is debounced** to avoid vault-file thrash on navigation; in-memory updates are immediate (so the view reflects them live via `onChange`), disk writes coalesce and are **flushed** on reader close + plugin unload.
- **No API change:** Recent is internal (reader-driven); `FALAH_API_VERSION` stays **6**. `BOOKMARKS_VERSION` stays **2** (recent is an additive optional field, no bump).
- **Never lose intentional bookmarks:** Recent operations never touch `groups`. `clearRecent` clears only `recent`.
- **Falah depends on no other plugin.** Tadabbur reference count stays **11**.
- New strings route through `t()` (en + ar short labels); new CSS uses Obsidian native vars only (no `--falah-*` Style Settings vars).
- Gate: `npm test`, `npm run lint` (0 errors), `npm run build` all pass.

## File Structure

- Modify `src/bookmarks/schema.ts` — `RecentEntry` type; `recent?` on `BookmarkStore`; `parseStore` passthrough.
- Modify `src/bookmarks/schema.test.ts`
- Modify `src/bookmarks/store.ts` — recent methods, debounce, `flush`, `setRecentCap`.
- Modify `src/bookmarks/store.test.ts`
- Modify `src/main.ts` — `bookmarkRecentCount` setting + control; wire `setRecentCap`; record-recent hook at nav points; `onunload` flush.
- Modify `src/reader.ts` — flush on `onClose`.
- Modify `src/bookmarks/view.ts` — Recent section.
- Modify `src/i18n/en.ts`, `src/i18n/ar.ts` — new keys.
- Modify `styles.css` — Recent section styles.

---

### Task 1: Schema — recent list

**Files:** Modify `src/bookmarks/schema.ts`, `src/bookmarks/schema.test.ts`

**Interfaces:**
- Produces: `RecentEntry { anchor: string; at: number }`; `BookmarkStore` gains `recent?: RecentEntry[]`; `parseStore` preserves a valid `recent` array (else omits it).

- [ ] **Step 1: Write the failing test** — add to `src/bookmarks/schema.test.ts`:

```ts
import { serializeStore, parseStore, BOOKMARKS_VERSION } from "./schema";
import { describe, it, expect } from "vitest";

describe("schema recent list", () => {
	it("recent round-trips", () => {
		const store = {
			version: BOOKMARKS_VERSION,
			groups: [],
			recent: [{ anchor: "falah://quran/2/255", at: 100 }, { anchor: "falah://quran/1/1", at: 90 }],
		};
		const back = parseStore(serializeStore(store));
		expect(back.recent).toEqual(store.recent);
	});
	it("a store without recent parses (recent undefined)", () => {
		const back = parseStore('{"version":2,"groups":[]}');
		expect(back.recent).toBeUndefined();
	});
	it("a malformed recent is dropped, not thrown", () => {
		const back = parseStore('{"version":2,"groups":[],"recent":"nope"}');
		expect(back.recent).toBeUndefined();
		expect(back.groups).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/schema.test.ts`
Expected: FAIL — `recent` not carried through `parseStore`.

- [ ] **Step 3: Write minimal implementation** — in `src/bookmarks/schema.ts`:
  1. Add the type and extend the store interface:
```ts
export interface RecentEntry {
	anchor: string;
	at: number;
}
```
  In `BookmarkStore` add `recent?: RecentEntry[];`.
  2. In `parseStore`, after building the return object, carry a valid `recent` array through. Change the return to:
```ts
		const recentRaw = (raw as { recent?: unknown }).recent;
		const result: BookmarkStore = {
			version: typeof (raw as { version?: unknown }).version === "number"
				? (raw as { version: number }).version
				: BOOKMARKS_VERSION,
			groups: groups.filter(isGroup),
		};
		if (Array.isArray(recentRaw)) {
			result.recent = recentRaw.filter(isRecent);
		}
		return result;
```
  and add the guard:
```ts
function isRecent(r: unknown): r is RecentEntry {
	if (!r || typeof r !== "object") return false;
	const x = r as Record<string, unknown>;
	return typeof x.anchor === "string" && typeof x.at === "number";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/schema.ts src/bookmarks/schema.test.ts
git commit -m "feat(bookmarks): recent list schema + parse passthrough"
```

---

### Task 2: Store — recent methods, debounce, flush

**Files:** Modify `src/bookmarks/store.ts`, `src/bookmarks/store.test.ts`

**Interfaces:**
- Consumes: `RecentEntry` (schema).
- Produces on `BookmarkStoreService`:
  - constructor gains an optional 4th param `recentDebounceMs = 3000`.
  - `setRecentCap(n: number): void` — 0 disables Recent.
  - `pushRecent(anchor: string): void` — dedupe (remove existing), unshift `{anchor, at: now}`, cap; updates memory + fires `onChange`; schedules a debounced persist. No-op when cap ≤ 0.
  - `listRecent(): RecentEntry[]`
  - `clearRecent(): Promise<void>` — immediate persist.
  - `flush(): Promise<void>` — cancels any pending debounce timer and persists if dirty.

- [ ] **Step 1: Write the failing test** — add to `src/bookmarks/store.test.ts` (reuse the `memIO` + `beforeEach`; note `svc` is constructed there — for these tests construct a local service with a small debounce and a cap):

```ts
describe("recent list", () => {
	let rio: ReturnType<typeof memIO>;
	let r: BookmarkStoreService;
	beforeEach(async () => {
		rio = memIO();
		r = new BookmarkStoreService(rio, "Falah/bookmarks.json", () => 100, 5); // 5ms debounce
		await r.load();
		r.setRecentCap(3);
	});

	it("pushRecent updates memory immediately, newest-first, deduped", () => {
		r.pushRecent("falah://quran/1/1");
		r.pushRecent("falah://quran/2/255");
		r.pushRecent("falah://quran/1/1"); // revisit → moves to front, no dup
		expect(r.listRecent().map((e) => e.anchor)).toEqual([
			"falah://quran/1/1", "falah://quran/2/255",
		]);
	});
	it("caps at the configured count", () => {
		["1/1", "1/2", "1/3", "1/4"].forEach((s) => r.pushRecent(`falah://quran/${s}`));
		expect(r.listRecent()).toHaveLength(3);
		expect(r.listRecent()[0].anchor).toBe("falah://quran/1/4");
	});
	it("cap 0 disables recording", () => {
		r.setRecentCap(0);
		r.pushRecent("falah://quran/1/1");
		expect(r.listRecent()).toHaveLength(0);
	});
	it("flush persists pending recent to disk", async () => {
		r.pushRecent("falah://quran/2/255");
		expect(rio.files["Falah/bookmarks.json"]).toBeUndefined(); // debounced, not yet written
		await r.flush();
		expect(rio.files["Falah/bookmarks.json"]).toContain("falah://quran/2/255");
	});
	it("clearRecent empties the list and persists immediately", async () => {
		r.pushRecent("falah://quran/1/1");
		await r.clearRecent();
		expect(r.listRecent()).toHaveLength(0);
		expect(rio.files["Falah/bookmarks.json"]).toContain('"recent": []');
	});
	it("pushRecent fires onChange for live view updates", () => {
		let fired = 0;
		r.onChange(() => fired++);
		r.pushRecent("falah://quran/1/1");
		expect(fired).toBe(1);
	});
});
```
(Import `BookmarkStoreService` is already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/store.test.ts`
Expected: FAIL — recent methods undefined.

- [ ] **Step 3: Write minimal implementation** — in `src/bookmarks/store.ts`:

Add `RecentEntry` to the schema import. Add the constructor param and fields:
```ts
	constructor(
		private io: FileIO,
		private path: string,
		private now: () => number = () => Date.now(),
		private recentDebounceMs = 3000,
	) {}

	private recentCap = 5;
	private recentTimer: ReturnType<typeof setTimeout> | null = null;
	private recentDirty = false;
```
Methods:
```ts
	setRecentCap(n: number): void {
		this.recentCap = Math.max(0, n);
	}

	listRecent(): RecentEntry[] {
		return this.store.recent ?? [];
	}

	pushRecent(anchor: string): void {
		if (this.recentCap <= 0) return;
		const recent = this.store.recent ?? (this.store.recent = []);
		const i = recent.findIndex((e) => e.anchor === anchor);
		if (i >= 0) recent.splice(i, 1);
		recent.unshift({ anchor, at: this.now() });
		if (recent.length > this.recentCap) recent.length = this.recentCap;
		this.recentDirty = true;
		for (const cb of this.listeners) cb();          // live view update
		if (this.recentTimer) clearTimeout(this.recentTimer);
		this.recentTimer = setTimeout(() => { this.recentTimer = null; void this.flush(); }, this.recentDebounceMs);
	}

	async clearRecent(): Promise<void> {
		this.store.recent = [];
		this.recentDirty = false;
		if (this.recentTimer) { clearTimeout(this.recentTimer); this.recentTimer = null; }
		await this.persist();
	}

	async flush(): Promise<void> {
		if (this.recentTimer) { clearTimeout(this.recentTimer); this.recentTimer = null; }
		if (this.recentDirty) { this.recentDirty = false; await this.persist(); }
	}
```
(`persist()` already serializes the whole store — which now includes `recent` — and fires `onChange`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/store.test.ts`
Expected: PASS (existing store tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/store.ts src/bookmarks/store.test.ts
git commit -m "feat(bookmarks): recent list store methods with debounced persist"
```

---

### Task 3: Settings — recent count + wiring

**Files:** Modify `src/main.ts`, `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Produces: `FalahSettings.bookmarkRecentCount: number` (default `5`); a settings control; `this.bookmarks.setRecentCap(...)` wired from the setting (after load + on change).

- [ ] **Step 1: Add the setting field + default**

In `src/main.ts`: add `bookmarkRecentCount: number;` to `FalahSettings`, and `bookmarkRecentCount: 5,` to `DEFAULT_SETTINGS`.

- [ ] **Step 2: Wire the cap into the store**

Right after the existing `this.bookmarks.setDefaultGroup(...)` call in `onload()` (added in PR1), add:
```ts
		this.bookmarks.setRecentCap(this.settings.bookmarkRecentCount);
```

- [ ] **Step 3: Add i18n keys**

`src/i18n/en.ts`:
```ts
	setBookmarkRecentCountName: "Recent items to keep",
	setBookmarkRecentCountDesc: "How many recently-read verses to track. 0 turns off the Recent section.",
	bookmarksRecentHeading: "Recent",
	bookmarksRecentClear: "Clear recent",
	bookmarksRecentSave: "Save to collection",
```
`src/i18n/ar.ts` (short labels):
```ts
	setBookmarkRecentCountName: "عدد العناصر الحديثة",
	bookmarksRecentHeading: "الأخيرة",
	bookmarksRecentClear: "مسح الأخيرة",
	bookmarksRecentSave: "حفظ في مجموعة",
```

- [ ] **Step 4: Add the settings control** — in `FalahSettingTab.display()`, under the existing Bookmarks heading (PR1), after the sort dropdown:

```ts
		new Setting(containerEl)
			.setName(t().setBookmarkRecentCountName)
			.setDesc(t().setBookmarkRecentCountDesc)
			.addText((tx) => tx
				.setValue(String(this.plugin.settings.bookmarkRecentCount))
				.onChange(async (v) => {
					const n = Math.max(0, Math.floor(Number(v) || 0));
					this.plugin.settings.bookmarkRecentCount = n;
					this.plugin.bookmarks.setRecentCap(n);
					await this.plugin.persist();
				}));
```

- [ ] **Step 5: Verify it builds**

Run: `npm run build` then `npm test`
Expected: both pass. Manually: Settings → Bookmarks → "Recent items to keep" accepts a number.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(bookmarks): recent-count setting wired to the store cap"
```

---

### Task 4: Reader hook — record recent on navigation + flush on unload/close

**Files:** Modify `src/main.ts`, `src/reader.ts`

**Interfaces:**
- Produces: `FalahPlugin.recordRecent(anchor: string): void`; calls at the three nav points; `flush()` on `onunload` and reader `onClose`.

- [ ] **Step 1: Add the record helper + nav-point calls** — in `src/main.ts`:

```ts
	/** Record an explicit read as a Recent entry (debounced persist in the store). */
	recordRecent(anchor: string): void {
		this.bookmarks.pushRecent(anchor);
	}
```
Then call it at the three explicit-navigation points:
- In `navigateReaderTo(surah, ayah)` (main.ts:184): add at the top
  ```ts
  this.recordRecent(toUri({ kind: "quran", surah, ayah }));
  ```
- In `openReader(surah = 1, ayah?)` (main.ts:477): when a specific ayah is targeted, add near the top of the method
  ```ts
  if (ayah !== undefined) this.recordRecent(toUri({ kind: "quran", surah, ayah }));
  ```
- In `openDetail(ref)` (main.ts:385): add at the top
  ```ts
  this.recordRecent(toUri(ref));
  ```
(`toUri` is already imported in main.ts.)

> Rationale: these are the "places you went." Clicking a bookmark/recent row routes through `openReader`/`openDetail`, so it's covered; the ribbon "open reader" (no ayah) does not record. No scroll tracking.

- [ ] **Step 2: Flush on unload** — in `src/main.ts` add (or extend) `onunload`:

```ts
	onunload(): void {
		void this.bookmarks?.flush();
	}
```

- [ ] **Step 3: Flush on reader close** — in `src/reader.ts` `onClose()` (reader.ts:533), add:

```ts
		void this.plugin.bookmarks.flush();
```
(Place it alongside the existing cleanup; `this.plugin` is the `FalahPlugin`.)

- [ ] **Step 4: Verify**

Run: `npm run build` then `npm test`
Expected: both pass. Manually: open the reader at a verse (or click a bookmark), then open the bookmarks view — the Recent section (Task 5) shows it; close the reader / quit Obsidian and reopen — recent persisted.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/reader.ts
git commit -m "feat(bookmarks): record recent on navigation, flush on close/unload"
```

---

### Task 5: View — Recent section

**Files:** Modify `src/bookmarks/view.ts`, `src/i18n/en.ts` (keys added in Task 3), `styles.css`

**Interfaces:**
- Consumes: `listRecent()`, `clearRecent()` (store); settings `bookmarkRecentCount`; `promptName` (PR1) for "Save to collection".

Insert a **Recent** section in `render()` **between** the ★ Favourites section and the collections loop (after the favourites block at view.ts:92-95, before the `for (const group of bm.list())` at :96-98). Rendered only when `settings.bookmarkRecentCount > 0` and `listRecent().length`:

- A header row: `t().bookmarksRecentHeading` + a **Clear** button (`t().bookmarksRecentClear` → `bm.clearRecent()`).
- One lighter row per `RecentEntry` (newest-first as stored — do NOT run `sortBookmarks`; recent is time-ordered). Each row:
  - the label via `parseRefUri(entry.anchor)` → `toLabel(ref)` (fall back to the anchor), reusing the row look but WITHOUT star/note/collection actions;
  - click → `openAnchor`-style open (reuse the existing open logic: quran → `this.plugin.openReader(surah, ayah)`, else `openDetail`);
  - a **＋ Save** action (`t().bookmarksRecentSave`) that promotes the anchor into a collection: `const name = await promptName(this.app, t().bookmarksNewCollection, "", t().bookmarkPromptCreate); if (name) await bm.add({ anchor: entry.anchor, group: name });` — or, simplest, add to the default collection via `bm.add({ anchor: entry.anchor })`. Use the promptName-to-collection flow to match the spec's "promote into a collection."

Add a small helper `renderRecentRow(root, entry)` rather than overloading `renderRow` (which expects a `Bookmark`). Recent rows carry a distinct class for styling.

- [ ] **Step 1: Implement the Recent section** in `src/bookmarks/view.ts` per the above. Reuse `parseRefUri`/`toLabel` (import `toLabel` from `../ref` if not already), `t()`, and the existing open logic. Guard on `this.plugin.settings.bookmarkRecentCount > 0 && bm.listRecent().length`.

- [ ] **Step 2: Add CSS** — append to `styles.css`: `.falah-bookmark-recent-row` (lighter than a bookmark row — e.g. `color: var(--text-muted)`, smaller), the Recent header + Clear button, and the ＋Save affordance (reveal-on-hover like `.falah-bookmark-remove`). Theme-aware, native vars only.

- [ ] **Step 3: Verify**

Run: `npm test`, `npm run lint` (0 errors), `npm run build` (all pass). Manually: read a few verses → Recent lists them newest-first; revisiting one moves it to the top; Clear empties it; ＋Save promotes an entry into a collection (and it now also appears there); setting Recent-count to 0 hides the section and stops recording.

- [ ] **Step 4: Commit**

```bash
git add src/bookmarks/view.ts styles.css
git commit -m "feat(bookmarks): Recent section in the bookmarks view"
```

---

### Task 6: Full green + invariant recheck

**Files:** none (verification).

- [ ] **Step 1: Full gate** — Run: `npm test && npm run lint && npm run build` — all pass (lint 0 errors).

- [ ] **Step 2: Invariants**
```bash
grep -rc "TADABBUR\|Tadabbur\|tadabbur" src/ | grep -v ':0' | awk -F: '{s+=$2} END {print s}'   # expect 11
grep -n "FALAH_API_VERSION = " src/api.ts                                                        # expect 6 (unchanged)
grep -n "BOOKMARKS_VERSION = " src/bookmarks/schema.ts                                           # expect 2 (unchanged)
```

- [ ] **Step 3: Manual acceptance (PR2 scope)**
- Reading verses populates Recent (newest-first, deduped, capped at the setting); revisiting moves to top.
- Recent persists across reader close and Obsidian restart (debounced write flushed on close/unload).
- Clear empties Recent; ＋Save promotes an entry into a collection.
- Recent count 0 hides the section AND stops recording.
- Intentional bookmarks/collections/favourites are untouched by any recent operation; `bookmarks.json` holds a top-level `recent` array separate from `groups`.

- [ ] **Step 4: Finish** — Commit any fixes, then use the finishing-a-development-branch skill (merge to master / PR per the user's choice).

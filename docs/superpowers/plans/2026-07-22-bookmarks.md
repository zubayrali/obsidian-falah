# Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save verses and hadith into named groups, in a non-fragile in-vault JSON store that survives reinstall/Clear-Cache, degrades gracefully when content is uninstalled, exposes a companion API, and imports/exports Markdown+JSON.

**Architecture:** A pure core (`src/bookmarks/{schema,markdown,resolve}.ts`, no `obsidian` import, vitest-tested) under a thin Obsidian-facing service (`src/bookmarks/store.ts` over the existing `FileIO`) and a leaf view (`src/bookmarks/view.ts`). Identity is the canonical `falah://` anchor from `ref.ts`; an optional `lens` is a soft pointer resolved at render time. Wired into `main.ts` and surfaced on `api.ts`.

**Tech Stack:** TypeScript, Obsidian plugin API, vitest. Reuses `src/ref.ts` (`toUri`/`toLabel`/`parseRefUri`/`toMarkdownLink`), `src/data/store.ts` `FileIO`, and `src/data/obsidian-io.ts` `makeFileIO`.

Spec: [`../specs/2026-07-22-bookmarks-design.md`](../specs/2026-07-22-bookmarks-design.md)

## Global Constraints

- **No new runtime dependencies.** Use stdlib + already-installed packages only.
- **Pure modules import no `obsidian` runtime.** `schema.ts`, `markdown.ts`, `resolve.ts` use `import type` only (mirrors `verse-actions.ts` / `data/obsidian-io.ts`). They must be importable under vitest.
- **Falah depends on no other plugin.** Nothing here imports Tadabbur. The deliberate-Tadabbur-reference count (`grep -rc "TADABBUR\|Tadabbur\|tadabbur" src/` summed = 11) must stay 11.
- **Identity = the `falah://` anchor.** Never key a bookmark by file/note. Always derive anchors/labels through `ref.ts`, never hand-format `falah://` strings.
- **Store lives in the vault**, not `data.json`. Default path `Falah/bookmarks.json`, via `makeFileIO(app.vault.adapter, "")` (vault-root-relative).
- **Never auto-delete a bookmark** because content is missing. Only the explicit "Clean up unresolvable bookmarks" command removes.
- **Listing never fetches verse/tafsir text.** Rows render from stored fields + O(1) registry checks.
- Lint/build gate: `npm run lint` and `npm run build` must pass; `npm test` green.

## File Structure

- Create `src/bookmarks/schema.ts` — types, id/lens-key derivation, dedup, serialize/parse. Pure.
- Create `src/bookmarks/schema.test.ts`
- Create `src/bookmarks/markdown.ts` — export→Markdown, import←Markdown/JSON. Pure.
- Create `src/bookmarks/markdown.test.ts`
- Create `src/bookmarks/resolve.ts` — degradation-state resolution given a registry snapshot. Pure.
- Create `src/bookmarks/resolve.test.ts`
- Create `src/bookmarks/store.ts` — `BookmarkStoreService` over `FileIO`: load/save/CRUD/events. Obsidian-agnostic (takes `FileIO`).
- Create `src/bookmarks/store.test.ts`
- Create `src/bookmarks/view.ts` — `BookmarksView` (Obsidian `ItemView`) + `VIEW_TYPE_BOOKMARKS`.
- Modify `src/verse-actions.ts` — add a `bookmark` default action (toggle add/remove).
- Modify `src/verse-actions.test.ts` — cover the new action's menu items.
- Modify `src/api.ts` — add `bookmarks` namespace + `onBookmarksChanged`; bump `FALAH_API_VERSION` 4→5.
- Modify `src/api.test.ts` — assert the new surface + version.
- Modify `src/main.ts` — settings field, wire service+view, ribbon, commands, API wiring.
- Modify `src/detail.ts` — a "Bookmark" button in the detail modal. *(concrete surface; see Task 9)*

**Scope note (v1 vs. fast-follow):** v1 create-surfaces are the reader ayah action, the "Bookmark reference under cursor" command, and the detail-view button. The **`falah://` chip right-click menu** and the **lens *creation* UI** are deferred fast-follows (schema already supports lenses; chip menu needs `decorations.ts` interaction design). Both are additive, no migration.

---

### Task 1: Bookmark schema (pure)

**Files:**
- Create: `src/bookmarks/schema.ts`
- Test: `src/bookmarks/schema.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `Lens { kind: "tafsir" | "translation"; editionId: string; lang?: string }`
  - `Bookmark { id: string; anchor: string; lens?: Lens; note?: string; added: number }`
  - `BookmarkGroup { id: string; name: string; order: number; collapsed?: boolean; items: Bookmark[] }`
  - `BookmarkStore { version: number; groups: BookmarkGroup[] }`
  - `BOOKMARKS_VERSION = 1`
  - `lensKey(lens?: Lens): string`
  - `bookmarkId(anchor: string, lens?: Lens): string`
  - `emptyStore(): BookmarkStore`
  - `serializeStore(store: BookmarkStore): string`
  - `parseStore(json: string): BookmarkStore`
  - `findBookmark(store: BookmarkStore, id: string): { group: BookmarkGroup; item: Bookmark } | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/bookmarks/schema.test.ts
import { describe, it, expect } from "vitest";
import {
	bookmarkId, lensKey, emptyStore, serializeStore, parseStore, findBookmark,
	BOOKMARKS_VERSION, type BookmarkStore,
} from "./schema";

describe("bookmark ids", () => {
	it("plain anchor id is the anchor", () => {
		expect(bookmarkId("falah://quran/2/255")).toBe("falah://quran/2/255");
		expect(lensKey()).toBe("");
	});
	it("lensed id disambiguates by edition", () => {
		const id = bookmarkId("falah://quran/2/255", { kind: "tafsir", editionId: "ar.ibnkathir" });
		expect(id).toBe("falah://quran/2/255#tafsir:ar.ibnkathir");
		expect(id).not.toBe(bookmarkId("falah://quran/2/255"));
	});
});

describe("serialize / parse", () => {
	it("round-trips a store", () => {
		const store: BookmarkStore = {
			version: BOOKMARKS_VERSION,
			groups: [{ id: "g1", name: "To memorize", order: 0, items: [
				{ id: "falah://quran/2/255", anchor: "falah://quran/2/255", note: "Ayat al-Kursi", added: 1000 },
			] }],
		};
		expect(parseStore(serializeStore(store))).toEqual(store);
	});
	it("garbage parses to an empty store, never throws", () => {
		expect(parseStore("not json")).toEqual(emptyStore());
		expect(parseStore("{}")).toEqual(emptyStore());
		expect(parseStore('{"version":1,"groups":"x"}')).toEqual(emptyStore());
	});
	it("emptyStore has the current version and no groups", () => {
		expect(emptyStore()).toEqual({ version: BOOKMARKS_VERSION, groups: [] });
	});
});

describe("findBookmark", () => {
	it("locates an item and its group by id", () => {
		const store = parseStore(serializeStore({
			version: BOOKMARKS_VERSION,
			groups: [{ id: "g1", name: "G", order: 0, items: [
				{ id: "a", anchor: "falah://quran/1/1", added: 1 },
			] }],
		}));
		expect(findBookmark(store, "a")?.item.anchor).toBe("falah://quran/1/1");
		expect(findBookmark(store, "missing")).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/bookmarks/schema.ts
// Pure bookmark model, id derivation, and JSON serialization. No "obsidian"
// import so vitest can run it directly. Identity is the falah:// anchor; a lens
// is an optional soft pointer to a specific view.

export interface Lens {
	kind: "tafsir" | "translation";
	editionId: string;
	lang?: string;
}
export interface Bookmark {
	id: string;
	anchor: string;
	lens?: Lens;
	note?: string;
	added: number;
}
export interface BookmarkGroup {
	id: string;
	name: string;
	order: number;
	collapsed?: boolean;
	items: Bookmark[];
}
export interface BookmarkStore {
	version: number;
	groups: BookmarkGroup[];
}

export const BOOKMARKS_VERSION = 1;

/** "" for no lens, else "tafsir:ar.ibnkathir" — stable, edition-level. */
export function lensKey(lens?: Lens): string {
	return lens ? `${lens.kind}:${lens.editionId}` : "";
}

/** Anchor identity for a plain bookmark; anchor + "#" + lensKey when lensed. */
export function bookmarkId(anchor: string, lens?: Lens): string {
	const k = lensKey(lens);
	return k ? `${anchor}#${k}` : anchor;
}

export function emptyStore(): BookmarkStore {
	return { version: BOOKMARKS_VERSION, groups: [] };
}

export function serializeStore(store: BookmarkStore): string {
	return JSON.stringify(store, null, 2);
}

/** Never throws: any malformed input degrades to an empty store. */
export function parseStore(json: string): BookmarkStore {
	try {
		const raw = JSON.parse(json) as unknown;
		if (!raw || typeof raw !== "object") return emptyStore();
		const groups = (raw as { groups?: unknown }).groups;
		if (!Array.isArray(groups)) return emptyStore();
		return {
			version: typeof (raw as { version?: unknown }).version === "number"
				? (raw as { version: number }).version
				: BOOKMARKS_VERSION,
			groups: groups.filter(isGroup),
		};
	} catch {
		return emptyStore();
	}
}

function isGroup(g: unknown): g is BookmarkGroup {
	if (!g || typeof g !== "object") return false;
	const x = g as Record<string, unknown>;
	return typeof x.id === "string" && typeof x.name === "string"
		&& typeof x.order === "number" && Array.isArray(x.items);
}

export function findBookmark(
	store: BookmarkStore,
	id: string,
): { group: BookmarkGroup; item: Bookmark } | null {
	for (const group of store.groups) {
		const item = group.items.find((i) => i.id === id);
		if (item) return { group, item };
	}
	return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/schema.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/schema.ts src/bookmarks/schema.test.ts
git commit -m "feat(bookmarks): pure schema, id derivation, serialize/parse"
```

---

### Task 2: Markdown export / import (pure)

**Files:**
- Create: `src/bookmarks/markdown.ts`
- Test: `src/bookmarks/markdown.test.ts`

**Interfaces:**
- Consumes: `BookmarkStore`, `bookmarkId` (Task 1); `parseRefUri`, `toMarkdownLink`, `toUri` from `../ref`.
- Produces:
  - `exportMarkdown(store: BookmarkStore): string`
  - `importText(text: string): BookmarkStore` — accepts either the Markdown format or a JSON store; merges nothing (returns a fresh store the caller merges).

- [ ] **Step 1: Write the failing test**

```ts
// src/bookmarks/markdown.test.ts
import { describe, it, expect } from "vitest";
import { exportMarkdown, importText } from "./markdown";
import { BOOKMARKS_VERSION, type BookmarkStore } from "./schema";

const store: BookmarkStore = {
	version: BOOKMARKS_VERSION,
	groups: [
		{ id: "g1", name: "To memorize", order: 0, items: [
			{ id: "falah://quran/2/255", anchor: "falah://quran/2/255", note: "Ayat al-Kursi", added: 1 },
		] },
		{ id: "g2", name: "Hadith", order: 1, items: [
			{ id: "falah://hadith/bukhari/1", anchor: "falah://hadith/bukhari/1", added: 2 },
		] },
	],
};

describe("markdown export", () => {
	it("writes group headings and falah:// list items with notes", () => {
		const md = exportMarkdown(store);
		expect(md).toContain("# To memorize");
		expect(md).toContain("(falah://quran/2/255)");
		expect(md).toContain("Ayat al-Kursi");
		expect(md).toContain("# Hadith");
		expect(md).toContain("(falah://hadith/bukhari/1)");
	});
});

describe("import", () => {
	it("round-trips exported markdown back into groups+anchors", () => {
		const back = importText(exportMarkdown(store));
		expect(back.groups.map((g) => g.name)).toEqual(["To memorize", "Hadith"]);
		expect(back.groups[0].items[0].anchor).toBe("falah://quran/2/255");
		expect(back.groups[0].items[0].note).toBe("Ayat al-Kursi");
	});
	it("accepts a JSON store too", () => {
		const back = importText(JSON.stringify(store));
		expect(back.groups[0].items[0].anchor).toBe("falah://quran/2/255");
	});
	it("ignores non-falah links and malformed lines", () => {
		const md = "# G\n- [x](https://example.com)\n- not a list item\n- [v](falah://quran/1/1)";
		const back = importText(md);
		expect(back.groups[0].items.map((i) => i.anchor)).toEqual(["falah://quran/1/1"]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/markdown.test.ts`
Expected: FAIL — cannot resolve `./markdown`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/bookmarks/markdown.ts
// Human-readable Markdown export and Markdown/JSON import. Pure; the anchor is
// always produced/consumed through ref.ts, never hand-formatted.

import { parseRefUri, toMarkdownLink, toUri } from "../ref";
import { bookmarkId, emptyStore, parseStore, BOOKMARKS_VERSION,
	type BookmarkStore, type Bookmark } from "./schema";

/** `# group` headings; `- [Label](falah://…) — note` items. */
export function exportMarkdown(store: BookmarkStore): string {
	const blocks = store.groups.map((g) => {
		const lines = [`# ${g.name}`, ""];
		for (const item of g.items) {
			const ref = parseRefUri(item.anchor);
			const link = ref ? toMarkdownLink(ref) : `[${item.anchor}](${item.anchor})`;
			lines.push(item.note ? `- ${link} — ${item.note}` : `- ${link}`);
		}
		return lines.join("\n");
	});
	return `# Falah Bookmarks\n\n${blocks.join("\n\n")}\n`;
}

const LINK_RE = /\[[^\]]*\]\((falah:\/\/[^)\s]+)\)(?:\s*[—-]\s*(.*))?/;

/** Import Markdown (headings = groups) or a JSON store. Returns a fresh store;
 *  the caller merges it into the live one. Never throws. */
export function importText(text: string): BookmarkStore {
	const trimmed = text.trim();
	if (trimmed.startsWith("{")) {
		const parsed = parseStore(trimmed);
		if (parsed.groups.length) return parsed;
	}
	const store = emptyStore();
	let group = { id: "imported", name: "Imported", order: 0, items: [] as Bookmark[] };
	store.groups.push(group);
	let order = 0;
	for (const line of text.split("\n")) {
		const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
		if (heading && heading[1].toLowerCase() !== "falah bookmarks") {
			group = { id: `g${order}`, name: heading[1], order: order++, items: [] };
			store.groups.push(group);
			continue;
		}
		const m = LINK_RE.exec(line);
		if (!m) continue;
		const ref = parseRefUri(m[1]);
		if (!ref) continue;
		const anchor = toUri(ref);
		group.items.push({
			id: bookmarkId(anchor),
			anchor,
			note: m[2]?.trim() || undefined,
			added: 0,
		});
	}
	// Drop the seed "Imported" group if headings supplied real ones.
	store.groups = store.groups.filter((g, i) => g.items.length || (i === 0 && store.groups.length === 1));
	store.version = BOOKMARKS_VERSION;
	return store;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/markdown.ts src/bookmarks/markdown.test.ts
git commit -m "feat(bookmarks): markdown export + markdown/json import"
```

---

### Task 3: Degradation-state resolution (pure)

**Files:**
- Create: `src/bookmarks/resolve.ts`
- Test: `src/bookmarks/resolve.test.ts`

**Interfaces:**
- Consumes: `Bookmark`, `Lens` (Task 1); `parseRefUri` from `../ref`.
- Produces:
  - `AvailabilitySnapshot { editions: Set<string>; collections: Set<string> }`
  - `RowState { anchorOk: boolean; lensState: "none" | "ok" | "dormant"; label: string; badge?: string }`
  - `resolveRow(item: Bookmark, snap: AvailabilitySnapshot): RowState`

- [ ] **Step 1: Write the failing test**

```ts
// src/bookmarks/resolve.test.ts
import { describe, it, expect } from "vitest";
import { resolveRow, type AvailabilitySnapshot } from "./resolve";

const snap: AvailabilitySnapshot = {
	editions: new Set(["ar.ibnkathir"]),
	collections: new Set(["bukhari"]),
};

describe("resolveRow", () => {
	it("plain verse resolves with no lens badge", () => {
		const s = resolveRow({ id: "a", anchor: "falah://quran/2/255", added: 0 }, snap);
		expect(s.anchorOk).toBe(true);
		expect(s.lensState).toBe("none");
		expect(s.label).toBe("Quran 2:255");
		expect(s.badge).toBeUndefined();
	});
	it("lens present + installed = ok", () => {
		const s = resolveRow(
			{ id: "a", anchor: "falah://quran/2/255", lens: { kind: "tafsir", editionId: "ar.ibnkathir" }, added: 0 },
			snap,
		);
		expect(s.lensState).toBe("ok");
	});
	it("lens present + uninstalled = dormant with a reinstall badge (not deleted)", () => {
		const s = resolveRow(
			{ id: "a", anchor: "falah://quran/2/255", lens: { kind: "tafsir", editionId: "en.gone" }, added: 0 },
			snap,
		);
		expect(s.lensState).toBe("dormant");
		expect(s.badge).toContain("en.gone");
	});
	it("hadith with uninstalled collection shows a stub badge but stays listed", () => {
		const s = resolveRow({ id: "a", anchor: "falah://hadith/muslim/1", added: 0 }, snap);
		expect(s.anchorOk).toBe(false);
		expect(s.badge).toContain("not installed");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/resolve.test.ts`
Expected: FAIL — cannot resolve `./resolve`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/bookmarks/resolve.ts
// Pure degradation logic: given a snapshot of what's installed, decide how a row
// renders. Never removes anything — missing content only downgrades the row.

import { parseRefUri, toLabel } from "../ref";
import type { Bookmark } from "./schema";

export interface AvailabilitySnapshot {
	editions: Set<string>;   // installed translation/tafsir edition ids
	collections: Set<string>; // installed hadith collection ids
}

export interface RowState {
	anchorOk: boolean;
	lensState: "none" | "ok" | "dormant";
	label: string;
	badge?: string;
}

export function resolveRow(item: Bookmark, snap: AvailabilitySnapshot): RowState {
	const ref = parseRefUri(item.anchor);
	const label = ref ? toLabel(ref) : item.anchor;

	let anchorOk = true;
	let badge: string | undefined;
	if (ref?.kind === "hadith" && !snap.collections.has(ref.collection)) {
		anchorOk = false;
		badge = `${ref.collection} not installed`;
	}

	let lensState: RowState["lensState"] = "none";
	if (item.lens) {
		if (snap.editions.has(item.lens.editionId)) {
			lensState = "ok";
		} else {
			lensState = "dormant";
			badge = `${item.lens.editionId} not installed — reinstall to restore`;
		}
	}
	return { anchorOk, lensState, label, badge };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/resolve.ts src/bookmarks/resolve.test.ts
git commit -m "feat(bookmarks): pure degradation-state resolution"
```

---

### Task 4: BookmarkStoreService (load/save/CRUD/events over FileIO)

**Files:**
- Create: `src/bookmarks/store.ts`
- Test: `src/bookmarks/store.test.ts`

**Interfaces:**
- Consumes: `FileIO` from `../data/store`; everything from Task 1; `bookmarkId`.
- Produces:
  - `class BookmarkStoreService`
    - `constructor(io: FileIO, path: string, now: () => number = () => Date.now())`
    - `load(): Promise<void>`
    - `list(): BookmarkGroup[]`
    - `has(anchor: string, lens?: Lens): boolean`
    - `add(input: { anchor: string; lens?: Lens; note?: string; group?: string }): Promise<Bookmark>`
    - `remove(id: string): Promise<void>`
    - `ensureGroup(name: string): BookmarkGroup`
    - `onChange(cb: () => void): () => void`
- Note: the default group name is `"Bookmarks"`. `add` with no `group` puts the item there, creating it if absent. Every mutation persists then fires `onChange`.

- [ ] **Step 1: Write the failing test**

```ts
// src/bookmarks/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { BookmarkStoreService } from "./store";
import type { FileIO } from "../data/store";

function memIO(seed: Record<string, string> = {}): FileIO & { files: Record<string, string> } {
	const files = { ...seed };
	return {
		files,
		async read(p) { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
		async write(p, d) { files[p] = d; },
		async exists(p) { return p in files; },
		async mkdir() {},
		async remove(p) { delete files[p]; },
		async rename(a, b) { files[b] = files[a]; delete files[a]; },
		async list() { return { files: [], folders: [] }; },
	};
}

describe("BookmarkStoreService", () => {
	let io: ReturnType<typeof memIO>;
	let svc: BookmarkStoreService;
	beforeEach(async () => {
		io = memIO();
		svc = new BookmarkStoreService(io, "Falah/bookmarks.json", () => 42);
		await svc.load();
	});

	it("load on a missing file starts empty", () => {
		expect(svc.list()).toEqual([]);
	});

	it("add creates the default group, persists, and fires onChange", async () => {
		let fired = 0;
		svc.onChange(() => fired++);
		const b = await svc.add({ anchor: "falah://quran/2/255", note: "AK" });
		expect(b.id).toBe("falah://quran/2/255");
		expect(b.added).toBe(42);
		expect(svc.list()[0].name).toBe("Bookmarks");
		expect(svc.has("falah://quran/2/255")).toBe(true);
		expect(fired).toBe(1);
		expect(io.files["Falah/bookmarks.json"]).toContain("falah://quran/2/255");
	});

	it("adding a duplicate anchor does not create a second item", async () => {
		await svc.add({ anchor: "falah://quran/2/255" });
		await svc.add({ anchor: "falah://quran/2/255" });
		expect(svc.list()[0].items).toHaveLength(1);
	});

	it("plain and lensed anchors coexist as distinct items", async () => {
		await svc.add({ anchor: "falah://quran/2/255" });
		await svc.add({ anchor: "falah://quran/2/255", lens: { kind: "tafsir", editionId: "ar.ibnkathir" } });
		expect(svc.list()[0].items).toHaveLength(2);
	});

	it("remove deletes by id and persists", async () => {
		const b = await svc.add({ anchor: "falah://quran/1/1" });
		await svc.remove(b.id);
		expect(svc.has("falah://quran/1/1")).toBe(false);
	});

	it("reload reads persisted state back", async () => {
		await svc.add({ anchor: "falah://quran/1/1", group: "Juz Amma" });
		const svc2 = new BookmarkStoreService(io, "Falah/bookmarks.json", () => 42);
		await svc2.load();
		expect(svc2.list().find((g) => g.name === "Juz Amma")?.items[0].anchor).toBe("falah://quran/1/1");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bookmarks/store.test.ts`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/bookmarks/store.ts
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

	/** Replace the whole store (used by import merge). */
	async replace(store: BookmarkStore): Promise<void> {
		this.store = store;
		await this.persist();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bookmarks/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/store.ts src/bookmarks/store.test.ts
git commit -m "feat(bookmarks): FileIO-backed store service with events"
```

---

### Task 5: Companion API surface (bump to v5)

**Files:**
- Modify: `src/api.ts`
- Test: `src/api.test.ts`
- Modify: `src/main.ts` (wire the namespace onto `this.api`)

**Interfaces:**
- Consumes: `BookmarkStoreService` (Task 4); `BookmarkGroup`, `Lens`, `Bookmark` (Task 1).
- Produces on `FalahApi`:
  - `version` becomes `5` (via `FALAH_API_VERSION`)
  - `onBookmarksChanged(cb: () => void): () => void`
  - `bookmarks: FalahBookmarksApi` where
    - `list(): BookmarkGroup[]`
    - `has(anchor: string, lens?: Lens): boolean`
    - `add(input: { anchor: string; lens?: Lens; note?: string; group?: string }): Promise<Bookmark>`
    - `remove(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/api.test.ts
import { FALAH_API_VERSION } from "./api";
import { describe, it, expect } from "vitest";

describe("api v5 bookmarks surface", () => {
	it("version is 5", () => {
		expect(FALAH_API_VERSION).toBe(5);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api.test.ts`
Expected: FAIL — `FALAH_API_VERSION` is still 4.

- [ ] **Step 3: Write minimal implementation**

In `src/api.ts`:
1. Bump the constant:
```ts
export const FALAH_API_VERSION = 5;
```
2. Add imports at the top (type-only — keeps `api.ts` runtime-light):
```ts
import type { BookmarkGroup, Bookmark, Lens } from "./bookmarks/schema";
```
3. Add the sub-interface and extend `FalahApi`:
```ts
export interface FalahBookmarksApi {
	list(): BookmarkGroup[];
	has(anchor: string, lens?: Lens): boolean;
	add(input: { anchor: string; lens?: Lens; note?: string; group?: string }): Promise<Bookmark>;
	remove(id: string): Promise<void>;
}
```
Inside `FalahApi` add:
```ts
	/** Bookmarks store. Added in v5. */
	bookmarks: FalahBookmarksApi;
	/** Fires after any bookmark add/remove/import. Added in v5. */
	onBookmarksChanged(cb: () => void): () => void;
```

In `src/main.ts`, first **declare the field and import** so the API literal typechecks (construction lands in Task 6 — the field is unused at runtime until then, and no code calls the API between tasks):
```ts
import { BookmarkStoreService } from "./bookmarks/store";
// …among the class's `!`-fields:
	bookmarks!: BookmarkStoreService;
```
Then extend the `this.api = { … }` literal (after `refreshReader`):
```ts
			bookmarks: {
				list: () => this.bookmarks.list(),
				has: (anchor, lens) => this.bookmarks.has(anchor, lens),
				add: (input) => this.bookmarks.add(input),
				remove: (id) => this.bookmarks.remove(id),
			},
			onBookmarksChanged: (cb) => this.bookmarks.onChange(cb),
```
(The `this.bookmarks` field is declared and constructed in Task 6.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/api.test.ts src/main.ts
git commit -m "feat(api): add bookmarks namespace, bump FALAH_API_VERSION to 5"
```

> **Cross-repo reminder (do NOT edit Tadabbur here):** when Tadabbur adopts this, bump its `REQUIRED_FALAH_API` and mirror `src/falah-api.d.ts` to 5. No CI pins this — grep both repos. See the Falah/Tadabbur integration invariants.

---

### Task 6: Wire the service + a "Bookmark" verse action

**Files:**
- Modify: `src/main.ts` (settings field, construct service, `load()`)
- Modify: `src/verse-actions.ts` (add the `bookmark` default action)
- Modify: `src/verse-actions.test.ts`

**Interfaces:**
- Consumes: `BookmarkStoreService`, `makeFileIO`, `toUri` from `../ref`.
- Produces:
  - `FalahPlugin.bookmarks: BookmarkStoreService` (public field)
  - `FalahSettings.bookmarksPath: string` (default `"Falah/bookmarks.json"`)
  - a new default verse action with `id: "bookmark"` that toggles add/remove for the verse and reflects state via `checked`.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/verse-actions.test.ts
import { defaultVerseActions } from "./verse-actions";
import { describe, it, expect } from "vitest";

describe("bookmark verse action", () => {
	it("offers a checked toggle reflecting store state", async () => {
		const action = defaultVerseActions().find((a) => a.id === "bookmark")!;
		expect(action).toBeTruthy();
		const added: string[] = [];
		const ctx = {
			surah: 2, ayah: 255, ayahKey: "2:255", arabic: "…",
			plugin: {
				bookmarks: {
					has: () => false,
					add: async (i: { anchor: string }) => { added.push(i.anchor); },
					remove: async () => {},
				},
			},
		} as any;
		const items = await action.items(ctx);
		expect(items[0].title).toMatch(/bookmark/i);
		expect(items[0].checked).toBe(false);
		await items[0].onClick!();
		expect(added).toEqual(["falah://quran/2/255"]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/verse-actions.test.ts`
Expected: FAIL — no action with `id: "bookmark"`.

- [ ] **Step 3: Write minimal implementation**

In `src/verse-actions.ts`, add `toUri` import and a new action inside `defaultVerseActions()` (place it first so it heads the menu):
```ts
import { toUri, type QuranRef } from "./ref";
```
```ts
		{
			id: "bookmark",
			items(ctx) {
				const anchor = toUri({ kind: "quran", surah: ctx.surah, ayah: ctx.ayah } as QuranRef);
				const saved = ctx.plugin.bookmarks.has(anchor);
				return [{
					title: saved ? "Remove bookmark" : "Bookmark verse",
					section: "falah-bookmark",
					icon: saved ? "bookmark-minus" : "bookmark",
					checked: saved,
					onClick: () => saved
						? ctx.plugin.bookmarks.remove(anchor)
						: void ctx.plugin.bookmarks.add({ anchor }),
				}];
			},
		},
```

In `src/main.ts` (the `bookmarks!: BookmarkStoreService` field and its import were already added in Task 5):
1. Add the setting to the interface and defaults:
```ts
	bookmarksPath: string;
```
```ts
	bookmarksPath: "Falah/bookmarks.json",
```
2. Construct + load in `onload()` (after `this.io = makeFileIO(...)`, before API assembly):
```ts
		const vaultIo = makeFileIO(this.app.vault.adapter, "");
		this.bookmarks = new BookmarkStoreService(vaultIo, this.settings.bookmarksPath);
		await this.bookmarks.load();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/verse-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/verse-actions.ts src/verse-actions.test.ts
git commit -m "feat(bookmarks): wire service in main + Bookmark verse action"
```

---

### Task 7: Bookmarks leaf view

**Files:**
- Create: `src/bookmarks/view.ts`
- Modify: `src/main.ts` (register view, ribbon, `open-bookmarks` command)

**Interfaces:**
- Consumes: `BookmarkStoreService` (Task 4), `resolveRow` + `AvailabilitySnapshot` (Task 3), `parseRefUri` from `../ref`, `FalahPlugin`.
- Produces:
  - `VIEW_TYPE_BOOKMARKS = "falah-bookmarks"`
  - `class BookmarksView extends ItemView` — renders groups + rows, subscribes to `onChange`, click opens the anchor via `plugin.openReader`/`plugin.openDetail`, shows the degradation badge, provides delete + "clean up unresolvable" affordances.

This is Obsidian-runtime glue (mirrors `QuranReaderView` in `reader.ts`). No unit test — validated by build + manual smoke. Build an `AvailabilitySnapshot` from the registry:
```ts
// installed editions:
const editions = new Set((await plugin.quranData.listResources())
	.filter((r) => r.type === "translation" || r.type === "tafsir")
	.map((r) => r.id));
```
For collections, reuse the hadith install index the reader/detail already query. Compute the snapshot once per render (O(installed), then O(1) per row).

- [ ] **Step 1: Create the view**

```ts
// src/bookmarks/view.ts
import { ItemView, Menu, type WorkspaceLeaf } from "obsidian";
import type FalahPlugin from "../main";
import { parseRefUri } from "../ref";
import { resolveRow, type AvailabilitySnapshot } from "./resolve";

export const VIEW_TYPE_BOOKMARKS = "falah-bookmarks";

export class BookmarksView extends ItemView {
	private unsub?: () => void;
	constructor(leaf: WorkspaceLeaf, private plugin: FalahPlugin) { super(leaf); }
	getViewType() { return VIEW_TYPE_BOOKMARKS; }
	getDisplayText() { return "Bookmarks"; }
	getIcon() { return "bookmark"; }

	async onOpen() {
		this.unsub = this.plugin.bookmarks.onChange(() => void this.render());
		await this.render();
	}
	async onClose() { this.unsub?.(); }

	private async snapshot(): Promise<AvailabilitySnapshot> {
		const editions = new Set(
			(await this.plugin.quranData.listResources())
				.filter((r) => r.type === "translation" || r.type === "tafsir")
				.map((r) => r.id),
		);
		const collections = new Set(await this.plugin.installedHadithCollections());
		return { editions, collections };
	}

	private async render() {
		const snap = await this.snapshot();
		const root = this.contentEl;
		root.empty();
		root.addClass("falah-bookmarks");
		for (const group of this.plugin.bookmarks.list()) {
			root.createEl("h3", { text: group.name });
			for (const item of group.items) {
				const state = resolveRow(item, snap);
				const row = root.createDiv({ cls: "falah-bookmark-row" });
				row.createSpan({ text: state.label });
				if (item.note) row.createSpan({ cls: "falah-bookmark-note", text: item.note });
				if (state.badge) row.createSpan({ cls: "falah-bookmark-badge", text: state.badge });
				row.onClickEvent(() => {
					const ref = parseRefUri(item.anchor);
					if (ref?.kind === "quran") void this.plugin.openReader(ref.surah, ref.ayah);
					else if (ref) this.plugin.openDetail(ref);
				});
				row.oncontextmenu = (e) => {
					const menu = new Menu();
					menu.addItem((mi) => mi.setTitle("Remove").setIcon("trash")
						.onClick(() => void this.plugin.bookmarks.remove(item.id)));
					menu.showAtMouseEvent(e);
				};
			}
		}
		if (!this.plugin.bookmarks.list().some((g) => g.items.length)) {
			root.createDiv({ cls: "falah-bookmarks-empty", text: "No bookmarks yet." });
		}
	}
}
```

- [ ] **Step 2: Add `installedHadithCollections()` helper to `main.ts`**

Add a public method that returns the installed collection ids (read from the hadith `InstallIndex` already constructed in `onload`). Keep the `InstallIndex` reference on the plugin (`this.hadithIndex = hadithIndex;` add a `hadithIndex!` field) and:
```ts
	async installedHadithCollections(): Promise<string[]> {
		return Object.keys((await this.hadithIndex.read())?.installed ?? {});
	}
```
> If `InstallIndex`'s read shape differs, adapt to its actual API (`src/data/content/install-index.ts`) — return the list of installed collection ids. This is the only line to reconcile with existing code.

- [ ] **Step 3: Register the view + ribbon + command in `main.ts` `onload()`**

```ts
import { BookmarksView, VIEW_TYPE_BOOKMARKS } from "./bookmarks/view";
```
```ts
		this.registerView(VIEW_TYPE_BOOKMARKS, (leaf) => new BookmarksView(leaf, this));
		this.addRibbonIcon("bookmark", "Open bookmarks", () => void this.openBookmarks());
		this.addCommand({
			id: "open-bookmarks",
			name: "Open bookmarks",
			callback: () => void this.openBookmarks(),
		});
```
Add the opener method (mirrors `openReader`, right sidebar leaf):
```ts
	async openBookmarks(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_BOOKMARKS)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false)!;
			await leaf.setViewState({ type: VIEW_TYPE_BOOKMARKS, active: true });
		}
		workspace.revealLeaf(leaf);
	}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: typecheck + bundle succeed. Manually: reload Obsidian, click the bookmark ribbon, bookmark a verse from the reader menu, confirm it appears in the view and clicking it opens the reader at that ayah.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarks/view.ts src/main.ts
git commit -m "feat(bookmarks): leaf view, ribbon, open-bookmarks command"
```

---

### Task 8: Command surfaces — bookmark under cursor, import/export, cleanup

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `exportMarkdown`/`importText` (Task 2), `refUnderCursor` (existing in `main.ts`), `toUri`, `BookmarkStoreService`.
- Produces: four commands: `bookmark-under-cursor`, `export-bookmarks`, `import-bookmarks`, `cleanup-bookmarks`.

- [ ] **Step 1: Add the commands in `onload()`**

```ts
		this.addCommand({
			id: "bookmark-under-cursor",
			name: "Bookmark reference under cursor",
			editorCheckCallback: (checking, editor) => {
				const ref = this.refUnderCursor(editor);
				if (!ref) return false;
				if (!checking) void this.bookmarks.add({ anchor: toUri(ref) });
				return true;
			},
		});
		this.addCommand({
			id: "export-bookmarks",
			name: "Export bookmarks to a Markdown note",
			callback: () => void this.exportBookmarks(),
		});
		this.addCommand({
			id: "import-bookmarks",
			name: "Import bookmarks from a note",
			editorCallback: (editor) => void this.importBookmarks(editor.getValue()),
		});
		this.addCommand({
			id: "cleanup-bookmarks",
			name: "Clean up unresolvable bookmarks",
			callback: () => void this.cleanupBookmarks(),
		});
```

- [ ] **Step 2: Add the helper methods on the plugin**

```ts
	async exportBookmarks(): Promise<void> {
		const md = exportMarkdown({ version: 1, groups: this.bookmarks.list() });
		const path = "Falah/Bookmarks.md";
		await this.app.vault.adapter.write(path, md);
		logMessage(`Exported bookmarks to ${path}`, "info");
	}

	async importBookmarks(text: string): Promise<void> {
		const incoming = importText(text);
		// Merge: add every incoming anchor that isn't already present, into its group.
		for (const g of incoming.groups) {
			for (const item of g.items) {
				if (!this.bookmarks.has(item.anchor, item.lens)) {
					await this.bookmarks.add({ anchor: item.anchor, lens: item.lens, note: item.note, group: g.name });
				}
			}
		}
		logMessage("Imported bookmarks", "info");
	}

	async cleanupBookmarks(): Promise<void> {
		const snap = {
			editions: new Set((await this.quranData.listResources())
				.filter((r) => r.type === "translation" || r.type === "tafsir").map((r) => r.id)),
			collections: new Set(await this.installedHadithCollections()),
		};
		let removed = 0;
		for (const g of [...this.bookmarks.list()]) {
			for (const item of [...g.items]) {
				const st = resolveRow(item, snap);
				// Only unresolvable ANCHORS are removed (missing hadith collection).
				// Dormant lenses are kept — the verse is still valid.
				if (!st.anchorOk) { await this.bookmarks.remove(item.id); removed++; }
			}
		}
		logMessage(`Removed ${removed} unresolvable bookmark(s)`, "info");
	}
```
Add imports at the top of `main.ts`:
```ts
import { exportMarkdown, importText } from "./bookmarks/markdown";
import { resolveRow } from "./bookmarks/resolve";
```

- [ ] **Step 3: Verify it builds and behaves**

Run: `npm run build`
Expected: passes. Manually: put the cursor on a `falah://` link, run "Bookmark reference under cursor", confirm it appears in the view. Run export → confirm `Falah/Bookmarks.md` is created; edit it, run import from that note → confirm new entries merge without duplicating existing ones.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(bookmarks): under-cursor, export, import, cleanup commands"
```

---

### Task 9: Detail-view bookmark button + settings path field

**Files:**
- Modify: `src/detail.ts` (add a Bookmark toggle to the modal)
- Modify: `src/main.ts` (`FalahSettingTab` — a text setting for `bookmarksPath`)

**Interfaces:**
- Consumes: `BookmarkStoreService`, `toUri`.
- Produces: a Bookmark button in `ReferenceDetailModal`; a "Bookmarks file path" setting.

- [ ] **Step 1: Add a Bookmark control to the detail modal**

In `src/detail.ts`, where the modal builds its header/action row, add a button that toggles the bookmark for the modal's `ref`:
```ts
const anchor = toUri(this.ref); // this.ref is the modal's IslamicReference
const saved = this.plugin.bookmarks.has(anchor);
const btn = headerEl.createEl("button", { text: saved ? "Bookmarked" : "Bookmark" });
btn.onclick = async () => {
	if (this.plugin.bookmarks.has(anchor)) await this.plugin.bookmarks.remove(anchor);
	else await this.plugin.bookmarks.add({ anchor });
	btn.setText(this.plugin.bookmarks.has(anchor) ? "Bookmarked" : "Bookmark");
};
```
Add `import { toUri } from "./ref";` if not already imported in `detail.ts`.
> Reconcile the exact element (`headerEl`) with the modal's real DOM in `detail.ts` — attach the button to the existing action row rather than inventing a container.

- [ ] **Step 2: Add the settings field**

In `FalahSettingTab.display()`, add:
```ts
new Setting(containerEl)
	.setName("Bookmarks file")
	.setDesc("Vault-relative path to the bookmarks JSON file.")
	.addText((t) => t
		.setPlaceholder("Falah/bookmarks.json")
		.setValue(this.plugin.settings.bookmarksPath)
		.onChange(async (v) => {
			this.plugin.settings.bookmarksPath = v || "Falah/bookmarks.json";
			await this.plugin.persist();
		}));
```
> Path changes take effect on next reload (the service reads the path at construction). This is acceptable for v1; note it in the setting's description if you prefer.

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: passes. Manually: open a reference detail modal, toggle Bookmark, confirm it reflects in the view.

- [ ] **Step 4: Commit**

```bash
git add src/detail.ts src/main.ts
git commit -m "feat(bookmarks): detail-view toggle + settings path field"
```

---

### Task 10: Full green + invariant recheck

**Files:** none (verification task).

- [ ] **Step 1: Full test + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 2: Recheck cross-repo invariants**

Run in `obsidian-falah`:
```bash
grep -rc "TADABBUR\|Tadabbur\|tadabbur" src/ | grep -v ':0' | awk -F: '{s+=$2} END {print s}'
```
Expected: `11` (unchanged — this work adds no Tadabbur dependency).
Confirm `FALAH_API_VERSION` is `5` and `src/api.ts` still imports nothing from Tadabbur.

- [ ] **Step 3: Manual acceptance pass (from the spec)**

- Bookmark a verse → reload Obsidian → still present (survives reinstall/Clear-Cache because it's in `Falah/bookmarks.json`, not `data.json`).
- Uninstall a hadith collection you had bookmarked → row still listed with a "not installed" badge; not deleted.
- Run "Clean up unresolvable bookmarks" → only the missing-collection rows are removed; verse bookmarks with dormant lenses remain.
- Export → import round-trips without duplicating existing entries.
- Open the view with many bookmarks → listing is instant (no verse text fetched).

- [ ] **Step 4: Commit any fixes, then finish the branch**

```bash
git add -A && git commit -m "chore(bookmarks): green build, invariants rechecked"
```
Then use the finishing-a-development-branch skill to decide merge/PR.

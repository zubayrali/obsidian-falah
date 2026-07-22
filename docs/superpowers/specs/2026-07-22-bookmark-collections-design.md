# Bookmark collections, favourites & recent — design

Status: approved design, ready for planning.
Builds on: [`2026-07-22-bookmarks-design.md`](2026-07-22-bookmarks-design.md) (the shipped bookmarks base).
Roadmap: [`../roadmap.md`](../roadmap.md) — expands Tier 1 story 1 (Bookmarks) and starts story 2 (Reading progress).

## Goal

The shipped bookmarks view is bare: every bookmark lands in one default group.
This iteration makes it a real organizer — user-created **collections**, a
cross-cutting **favourite** star, and an auto-tracked **Recent** list — plus a
**Bookmarks settings** section. The three entry kinds stay conceptually
distinct: *intentional* (collections), *flagged* (favourites), *automatic*
(recent). Cramming all into `groups` is exactly what we avoid.

## Delivery in two phases (one spec, two PRs)

- **PR 1 — Collections + Favourites + Settings.** Collection management UI,
  the favourite flag, the quick-save+submenu interaction, and the Bookmarks
  settings section. All on the existing in-vault store.
- **PR 2 — Recent / last-read + reader hook.** The separate `recent` list, the
  debounced persistence, and the reader-navigation hook. Starts the Reading
  Progress roadmap story.

The data model below is defined once (both phases), so PR 1 adds the
`favourite` field and PR 2 adds `recent` — no migration between them (all
additions are optional fields; `BOOKMARKS_VERSION` bumps 1→2 in PR 1).

## Data model (`src/bookmarks/schema.ts`)

```ts
Bookmark      { id; anchor; lens?; note?; added; favourite?: boolean }  // + favourite (PR1)
BookmarkGroup { id; name; order; collapsed?; items: Bookmark[] }        // unchanged
RecentEntry   { anchor: string; at: number }                           // new (PR2)
BookmarkStore { version; groups: BookmarkGroup[]; recent?: RecentEntry[] }  // + recent (PR2)
BOOKMARKS_VERSION = 2
```

- **Collection = a `BookmarkGroup`** (already exists; now managed).
- **Favourite = `favourite?: boolean` on a Bookmark** — a cross-cut, NOT a
  collection. A favourited item appears in *both* the ★ Favourites section and
  its collection. Absent/`false` = not favourited.
- **Recent = `recent: RecentEntry[]`** on the store — capped, newest-first,
  deduped by anchor, never in any group. A recent entry is not a `Bookmark`; it
  carries no note/lens/collection.
- Migration: `parseStore` already tolerates missing keys; back-fill
  `recent: []` and treat missing `favourite` as `false`. No destructive step.
  The `version` field flips to 2 so a future breaking change can detect v1.

## Store service (`src/bookmarks/store.ts`)

**Collections (PR 1):**
- `createGroup(name): BookmarkGroup`
- `renameGroup(id, name): void`
- `deleteGroup(id): void` — **moves the group's items into the default
  collection, then removes the group. Never deletes a bookmark.** The default
  collection (`"Bookmarks"`, see settings) cannot be deleted.
- `moveItem(itemId, toGroupId): void` — reassign a bookmark to another
  collection (no-op if already there).
- Reorder: groups render by `order`; drag updates `order`. A
  `setGroupOrder(orderedIds)` helper persists the new order.
- `add(input)` keeps its `group?` param (the interaction passes the chosen
  collection or the configured default).

**Favourites (PR 1):**
- `toggleFavourite(anchor, lens?): boolean` — ensures a bookmark for
  `anchor(+lens)` exists (creates it in the default collection if absent), flips
  `favourite`, returns the new state.
- `favourites(): Bookmark[]` — every item with `favourite === true`, across all
  groups, in current sort order.

**Recent (PR 2):**
- `pushRecent(anchor): void` — remove any existing entry for `anchor`, unshift
  `{anchor, at}`, truncate to the configured count. Updates memory
  synchronously; schedules a **debounced** persist (see below).
- `listRecent(): RecentEntry[]`; `clearRecent(): void`.

**Persistence:**
- Intentional mutations (add/remove/collection/favourite) persist immediately,
  as today.
- `pushRecent` persists **debounced** (~3s idle) to avoid vault-file thrash on
  navigation. `flush(): Promise<void>` writes any pending debounced state; the
  plugin calls it on reader close and `onunload`. Debounce uses `setTimeout`
  (no obsidian import; the module stays pure of the runtime).
- All mutations still fire `onChange` so the view re-renders live.

## Interactions — verse & detail menus (PR 1)

The verse action (and the detail-modal button area) offer:
- **Bookmark verse** (quick → default collection) / **Remove bookmark** — the
  existing toggle, unchanged for the common case.
- **Bookmark to ▸** — a submenu (the `VerseMenuItem.submenu` mechanism already
  exists) listing the user's collections + **＋ New collection…**. Picking a
  collection saves straight there; **New collection…** opens a name prompt
  (a small obsidian modal invoked via a plugin method — the pure verse-action
  module only wires `onClick` to plugin methods) then saves into it.
- **★ Add to favourites / Remove from favourites** — calls
  `toggleFavourite`.

`verse-actions.ts` stays a pure module: it reads `ctx.plugin.bookmarks.list()`
for collection names and calls `ctx.plugin.*` methods for anything obsidian
(prompt modal). Its menu strings stay hardcoded, consistent with its siblings.

## Bookmarks view (`src/bookmarks/view.ts`) — three sections

Top to bottom, each hidden when empty or disabled by settings:

1. **★ Favourites** — pinned; `favourites()` rendered as rows (same row
   component). Favourited items also still appear in their collection below.
2. **Recent** (PR 2) — `listRecent()` as lighter rows (no collection, no note),
   with a **Clear** action in the section header and a per-row **＋ Save**
   that promotes a recent anchor into a collection (via the same
   quick-save/submenu path).
3. **Collections** — each non-empty `group` (empty ones still shown so they can
   receive items) as a **collapsible** section honoring `collapsed`; a
   per-collection header menu (rename, delete, add) and a top-level
   **＋ New collection**. Row actions: **star** toggle, **move to…** (context
   menu listing collections), **remove**. Items **drag** between collections;
   collection headers **drag** to reorder.

Sort within a section follows the `bookmarkSort` setting (added-newest /
manual-order / surah-order). Rows keep the existing degradation behavior
(dormant-lens badge / missing-collection stub, never auto-delete). New
user-facing strings route through `t()` (en + ar), matching the shipped
bookmarks i18n; new view classes get theme-aware CSS.

## Reader hook (PR 2) — what becomes "recent"

`pushRecent(anchor)` fires on **explicit navigation**, not scroll:
- `openReader(surah, ayah)` and `navigateReaderTo(surah, ayah)` (when an ayah is
  targeted),
- opening a detail/ref view,
- clicking a bookmark or recent row.

Scroll-position "current ayah" tracking and per-surah furthest-read are the full
Reading Progress story — out of scope here. This captures "places you went,"
which is what "last read (last N)" means.

## Settings — new "Bookmarks" section (`FalahSettingTab`, PR 1; recents row PR 2)

Added to `FalahSettings`:
```ts
bookmarksPath: string;              // exists
bookmarkDefaultCollection: string;  // default "Bookmarks"
bookmarkRecentCount: number;        // default 5; 0 disables Recent (PR2)
bookmarkShowFavourites: boolean;    // default true
bookmarkSort: "added" | "manual" | "surah";  // default "added"
```
Controls: Default collection (dropdown of existing collection names) ·
Recent items to keep (number; 0 = off) · Show ★ Favourites section (toggle) ·
Default sort (dropdown) · Bookmarks file path (existing). Setting names/descs
route through `t()`.

## Companion API — `FALAH_API_VERSION` 5→6 (additive)

Add to the `bookmarks` namespace:
```ts
setFavourite(id: string, on: boolean): Promise<void>
favourites(): Bookmark[]
createCollection(name: string): Promise<BookmarkGroup>
moveItem(id: string, toGroupId: string): Promise<void>
```
`list()` return type gains the optional `favourite` field (non-breaking).
Recent is internal (reader-driven) and NOT exposed unless a companion needs it.
Cross-repo invariants unchanged: Falah imports nothing from Tadabbur; when
Tadabbur adopts v6 it re-mirrors `REQUIRED_FALAH_API` and `src/falah-api.d.ts`
(no CI pin — grep both repos). Reference count stays 11.

## Testing

Pure/logic gets vitest, matching the shipped feature's density:
- schema: `favourite` round-trips; `recent` round-trips + cap/dedup; v1→v2
  parse back-fills.
- store: `createGroup`/`renameGroup`/`deleteGroup` (items move to default, not
  deleted); `moveItem`; `toggleFavourite` (creates-then-flips, and unflip keeps
  the bookmark); `favourites()` filter; `pushRecent` dedupe+cap; debounced
  persist flushes via `flush()`; `deleteGroup` refuses/handles the default.
- resolve/markdown/degradation: unchanged behavior still passes; favourited &
  recent rows render without fetching text.
IO stays behind the `FileIO` interface; the view is obsidian-runtime (build-gated).

## Scope boundaries

**In:** collections management, favourite flag, recent list, bookmark settings,
reader-navigation recent hook, API v6, i18n + CSS for all new surfaces.
**Out (future roadmap):** scroll-based current-ayah tracking & per-surah
furthest-read (rest of Reading Progress), the `falah://` chip right-click menu,
the lens *creation* UI, multi-level nested collections (single-level only).

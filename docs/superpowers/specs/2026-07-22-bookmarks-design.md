# Bookmarks — design

Status: approved design, ready for implementation planning.
Roadmap: [`../roadmap.md`](../roadmap.md) → Tier 1, story 1.

## Goal

Let a user save verses and hadith (and later, specific tafsir/translation
*views* of them) and return to them fast — in a store that is **not fragile**:
it survives plugin reinstall and Clear-Cache, syncs with the vault, imports and
exports, and never loses a bookmark when underlying content is uninstalled.

## Design principle: decouple identity, storage, and access

Three worries — durability, Tadabbur leverage, import/export — only conflict if
you conflate these. Kept separate, each is easy:

1. **Identity = the `falah://` ref** (content-addressed, not file-addressed). A
   bookmark points at `quran/2/255`, never at a note that can move or rename.
   This is what makes it non-fragile, and it is already how `ref.ts` works.
2. **Access = the Falah companion API**, not the file format. Tadabbur and other
   plugins read/subscribe via `api.ts`; they never parse the store. Storage
   format stays a private, changeable decision.
3. **Import/export = serialization**, trivial once (1) and (2) hold.

## Data model

```ts
BookmarkStore { version: number; groups: BookmarkGroup[] }
BookmarkGroup { id: string; name: string; order: number; collapsed?: boolean; items: Bookmark[] }
Bookmark      { id: string; anchor: string; lens?: Lens; note?: string; added: number }
Lens          { kind: "tafsir" | "translation"; editionId: string; lang?: string }
```

- **anchor** — a canonical `falah://` URI (`falah://quran/2/255`,
  `falah://hadith/bukhari/1`). Stable identity; never breaks on file moves.
- **lens** — optional *soft pointer* to a specific view, resolved at render
  time. Stores the **edition identifier** (`en.sahih`, `ar.ibnkathir` — the
  semantic, stable name), **not** the ephemeral installed-resource handle, so it
  survives uninstall→reinstall. `kind` is an open enum: future kinds (e.g.
  `audio` with a reciter) extend the model without touching the anchor.
- **item id** = `anchor` + a lens-key derived from `lens` (empty for no lens).
  So "2:255 plain" and "2:255 via Ibn Kathir" are two distinct bookmarks with
  distinct intent, and dedup is exact.
- **groups** — user-named, single-membership, ordered. `order` ints + stable
  ids so merges/dedup are id-based.

<!-- ponytail: arrays-with-stable-ids, not a CRDT. Obsidian Sync is whole-file
     LWW for JSON, so per-item merge only helps git/text-merge users; revisit
     only if multi-device conflicts actually bite. -->

## Storage

- A single JSON file **in the vault**, path configurable, default
  `Falah/bookmarks.json`. Vault content ⇒ syncs, survives reinstall and
  Clear-Cache (unlike `data.json`, which is invisible, unsynced, and wiped).
- Access behind a small IO interface mirroring `src/data/obsidian-io.ts`, so the
  pure store logic is testable without Obsidian.
- `version` field on the store for forward-compatible migrations.

## Surfaces

**Create** — reuse existing seams, no new interaction paradigms:
- Reader ayah-row action (the verse-actions pattern in `verse-actions.ts`).
- Detail view action.
- `falah://` chip context menu.
- Command: *"Bookmark reference under cursor."*

**View** — a dedicated leaf, same shape as the reader view:
- Collapsible groups; drag-to-reorder within/between groups; create / rename /
  delete group; per-row inline note.
- Click a row → open detail/reader at the anchor, applying the lens if present.
- Ribbon icon + command *"Open bookmarks."*

## Degradation — what happens when content is deleted

Because anchor and lens are separate, deletion is degradation, never data loss:

| Event | Outcome |
|---|---|
| Edition (tafsir/translation) uninstalled | Anchor still valid. Row renders the verse with current settings + a dormant-lens badge: *"Ibn Kathir tafsir not installed — [reinstall]"*. Lens dormant, not deleted. |
| Hadith collection uninstalled | Row shows `bukhari/1` as a stub: *"Bukhari not installed."* Still listed. |
| Clear Cache | Nothing lost — store lives in the vault, not the cache. Rendered text re-fetches lazily. |
| Edition reinstalled | Lens re-resolves automatically; badge disappears; no user action. |

Rules:
- **Never auto-delete** a bookmark because a resource went away.
- The only remover is a manual command *"Clean up unresolvable bookmarks."*
- Availability is computed **lazily at render** — a dormant lens costs nothing
  until viewed.

## Performance

- **Listing never fetches content.** Each row renders from stored
  `{anchor, lens, note, added}`. "Is this edition installed?" is an **O(1)**
  lookup against the in-memory resource registry (`data/registry.ts` /
  `data/content/install-index.ts`). Listing 1000 bookmarks is instant.
- The expensive part (fetching 2:255's Arabic + the tafsir text) stays **lazy
  and rides the existing cache layer**, and only runs when a row is expanded or
  opened — the same cost as opening the ref normally today.
- **Bookmarking a tafsir adds zero cost to the list**; it adds one lazy,
  already-cached fetch the moment that specific bookmark is opened.

## Companion API

Add a `bookmarks` namespace to `api.ts` and bump `FALAH_API_VERSION` 4 → 5
(additive — Falah still depends on no other plugin):

```ts
api.bookmarks.list(): BookmarkGroup[]
api.bookmarks.has(anchor: string, lens?: Lens): boolean
api.bookmarks.add(input: { anchor: string; lens?: Lens; note?: string; group?: string }): void
api.bookmarks.remove(id: string): void
api.onBookmarksChanged(cb): () => void   // matches the existing event/registry pattern
```

**Cross-repo invariants (must re-check on merge):**
- Bumping `FALAH_API_VERSION` to 5 means Tadabbur's `REQUIRED_FALAH_API` and
  `src/falah-api.d.ts` mirror must be updated **in that repo** when it adopts the
  API — no automated cross-repo test pins this; grep both repos.
- Falah imports nothing from Tadabbur; the reference count invariant (11) must
  not change from this work.

**Tadabbur seam (opt-in, one-directional):**
- Tadabbur *reads* bookmarks via this API to offer *"reflect on this bookmark"*
  (its `note` promotes to a full `> [!quran]` reflection via Falah's existing
  `toCallout(ref, text?)`), and to show a ★-on-refs indicator.
- Falah never calls Tadabbur. The callout-as-connection invariant is untouched.

## Import / export

- **Export → Markdown note** (`Falah/Bookmarks.md`): `#` group headings,
  `- [label](falah://…)` items + note text. Human-readable, portable — this is
  markdown-as-truth's benefit without inheriting its parse fragility.
- **Import ← Markdown or JSON:** scan for `falah://` links (reuse
  `ref.ts` `parseRefUri`), group by heading, merge by item-id, skip dupes.

## Scope (v1 vs. fast-follow)

**v1:** schema + in-vault JSON store + named groups + bookmarks leaf view +
create-from-reader/detail/chip/command + plain verse & hadith bookmarking +
Markdown/JSON export & import + `bookmarks.*` API + degradation handling.

**Fast-follow (schema-ready, no migration):** the lens *creation* UI
("bookmark this tafsir/translation"). The store already carries `lens`, so this
is additive.

## Testing

Pure functions get vitest coverage, matching the repo's `.test.ts` density:
- store serialize ↔ parse (schema + `version`)
- Markdown export ↔ import round-trip
- item-id / lens-key derivation and dedup
- degradation-state resolution (installed vs. dormant vs. stub) given a fake
  registry

IO is behind an interface (as `data/store.test.ts` / `data/obsidian-io.ts` do),
so store logic is exercised without Obsidian.

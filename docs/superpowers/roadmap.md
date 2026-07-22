# Falah roadmap

Candidate stories that stand between Falah-today and a full-fledged Quran app.
Each story is written for a build agent: **goal**, **scope**, **acceptance criteria**.
Built on what already exists (reader, `falah://` refs, data layer, companion API),
so nothing here re-treads reader customizability (in progress) or the existing
reference/slash-command/honorific systems.

Priority order within a tier is top-to-bottom. Deep-spec a story into
`docs/superpowers/specs/` before building it.

---

## Tier 1 — core reading loop

### 1. Bookmarks — *deep-specced: [`specs/2026-07-22-bookmarks-design.md`](specs/2026-07-22-bookmarks-design.md)*
**Goal:** Save verses/hadith (and later specific tafsir/translation views) and get back to them fast, in a store that survives reinstall, syncs with the vault, and imports/exports.
**Scope:** anchor+lens data model, in-vault JSON store, named flat groups, a bookmarks leaf view, create-from-reader/detail/chip/command, graceful degradation when a resource is uninstalled, companion API (`bookmarks.*`), Markdown/JSON import+export. Lens *creation* UI is a fast-follow.
**Acceptance:** a bookmarked verse persists across reinstall and Clear-Cache; uninstalling a tafsir never deletes a bookmark (shows a dormant badge); listing 1000 bookmarks fetches no verse text; export→import round-trips; API is additive (Falah still depends on nothing).

### 2. Reading progress & resume
**Goal:** Never lose your place. Reopen the reader where you left off, per surah, and jump straight back.
**Scope:** track last-read position (surah + ayah + scroll anchor) and per-surah furthest-read; a "Continue reading" command + reader affordance; persist in the same in-vault store pattern as bookmarks (progress is content, should sync/survive); optional subtle "read up to here" marker in the reader.
**Acceptance:** closing and reopening the reader restores the last position; "Continue reading" opens the furthest-read ayah of the last-read surah; progress survives reinstall; no measurable scroll-tracking jank.

### 3. Navigation & go-to
**Goal:** Reach any place in the Quran in two keystrokes, by any addressing scheme.
**Scope:** a surah/juz/hizb/page index (a picker or sidebar), a fuzzy "jump to 2:255 / Al-Baqarah / juz 3 / page 50" command palette that resolves multiple addressing schemes to a `falah://` ref, and in-reader next/prev surah + juz controls.
**Acceptance:** typing "2:255", "baqara 255", "juz 3", and "page 50" all resolve to the correct location; the index lists all 114 surahs / 30 juz / 60 hizb / 604 pages with correct start refs; jumping scrolls the reader to the exact ayah.

### 4. Search
**Goal:** Find any ayah by its words, in Arabic or any installed translation, and jump to it.
**Scope:** full-text search over bundled Arabic + installed translation/tafsir editions; a results view (ayah ref + snippet with match highlighted) that opens the reader at the hit; scope filter (which edition/language to search); reasonable index build that respects Falah's offline-first, lazy-install model (only search what's installed).
**Acceptance:** searching an Arabic phrase and an English phrase both return correct ayahs with highlighted snippets; results jump into the reader at the right ayah; search only queries installed editions (no network); index build/query stays responsive on a full mushaf.

---

## Tier 3 — reading depth

### 5. Audio recitation *(largest single story — consider decomposing)*
**Goal:** Listen to the Quran with follow-along, choosing your reciter.
**Scope:** per-ayah and continuous playback; reciter selection (installed/streamed per Falah's resource model); follow-along highlight in the reader synced to the current ayah; basic transport (play/pause/next/prev, repeat-ayah/range for memorization); respect offline-first (cache audio where possible, stream with clear fallback).
**Acceptance:** playing from an ayah advances through the surah with the current ayah highlighted; reciter selection persists; repeat-range loops the chosen ayahs; playback controls are reachable by command and in-reader; behaves gracefully offline (clear message, no crash).

### 6. Word-by-word
**Goal:** Understand each word, not just each ayah.
**Scope:** per-word gloss/transliteration/translation shown under or on hover of each Arabic word in the reader; a toggle in reader settings; leans on `QuranRef`'s existing `fromWord/toWord` for addressing; data sourced from an installable word-by-word edition per the resource model.
**Acceptance:** toggling word-by-word renders per-word glosses aligned to the Arabic; the toggle persists; missing word-data degrades to the plain ayah with a clear "install word-by-word data" affordance; no layout breakage in Uthmani or IndoPak.

### 7. Multi-translation / tafsir compare
**Goal:** Read two or more translations, or a translation alongside a tafsir, side by side.
**Scope:** select N editions to display together for the current ayah/surah (columns or stacked); reuse the installed-edition registry; a compact toggle to add/remove editions from the comparison; sensible layout on mobile (stacked) and desktop (columns).
**Acceptance:** selecting two translations shows both per ayah, correctly aligned; adding a tafsir column works the same way; the selection persists; uninstalling one edition drops its column gracefully; readable on mobile.

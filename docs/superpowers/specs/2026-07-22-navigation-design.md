# Navigation & go-to — design

Status: approved design, ready for planning.
Roadmap: [`../roadmap.md`](../roadmap.md) — Tier 1, story 3 (Navigation & go-to).

## Goal

Reach any place in the Quran fast, by any addressing scheme: surah, ayah, juz,
hizb/rub, page, and sajdah. A fuzzy "jump to" palette resolves typed queries to
a location; a browse index lists the schemes for tapping; in-reader prev/next
steps by surah and juz. All offline, from bundled authoritative data.

## Delivery in two phases (one spec, two PRs)

- **PR 1 — get anywhere fast.** Bundled boundary data + generation script,
  the pure resolver + reverse-lookup helpers, the fuzzy **Jump to…** palette,
  in-reader **surah/juz prev-next**, and a small **Arabic-name display tweak**
  to the toolbar surah selector (folded in since PR1 touches that toolbar).
- **PR 2 — browse & orient.** A **browse index** modal (Surahs · Juz · Pages ·
  Sajdah tabs) and a **current-position display** ("Juz 3 · Page 42") in the
  reader header via reverse lookup.

## Data — bundled, authoritative

Falah already bundles `assets/bundled-core/surahs.json` (114 surahs, complete
`nameArabic` / `nameEnglish` / `nameTransliterated` / `ayahCount`), loaded via
`registry.core.getSurahs()`. Navigation reuses this table for all surah
names/matching — so it is independent of the installed translation.

**New:** a bundled `assets/bundled-core/quran-nav.json` of boundary tables for
the standard Madani mushaf, produced by a **generation script**
(`scripts/gen-quran-nav.mjs`, mirroring the existing `scripts/gen-nawawi40.mjs`)
that parses **Tanzil's `quran-data.xml`** — the canonical metadata with
`<juz>`, `<hizb>`/`<quarter>` (rub'), `<page>`, `<sajda>`, and `<ruku>` elements
(each carrying sura + aya). Shape:

```jsonc
{
  "juz":      [{ "n": 1, "surah": 1, "ayah": 1 }, … 30 ],
  "hizb":     [{ "n": 1, "surah": 1, "ayah": 1 }, … 60 ],
  "rub":      [{ "n": 1, "surah": 1, "ayah": 1 }, … 240 ],
  "pages":    [{ "n": 1, "surah": 1, "ayah": 1 }, … 604 ],
  "sajdahs":  [{ "surah": 7, "ayah": 206, "type": "recommended" }, … 15 ],
  "ruku":     [{ "n": 1, "surah": 1, "ayah": 1 }, … ~540 ]
}
```

- The runtime only **reads** the JSON — no new runtime dependency; the parse is
  a one-time dev script (any XML parsing / fetch stays in `scripts/`).
- **Authoritativeness is a hard requirement:** boundary data must come from
  Tanzil (or an equally canonical source), never hand-typed or model-generated
  — a wrong page/juz boundary is a silent, confusing bug. The generation script
  is checked in so the data is reproducible and auditable.
- **Ruku** is bundled (Tanzil provides it for free while parsing) but gets **no
  dedicated UI** in v1 — it's niche and ~540 entries. The data is present for
  future use / reverse lookup.

## Resolver — pure, tested (`src/nav/resolve.ts`)

`resolveNav(query, surahs, nav): NavCandidate[]` — pure, no `obsidian` import,
vitest-tested. Returns ranked candidates:

```ts
interface NavCandidate { surah: number; ayah: number; label: string; sublabel?: string; kind: "ayah"|"surah"|"juz"|"hizb"|"rub"|"page"|"sajdah"; }
```

Recognised query forms:
- `2:255` → surah:ayah.
- surah name — `baqara` / `al-baqarah` / `البقرة`, diacritics- and
  hyphen-insensitive, matched against `nameTransliterated` / `nameEnglish` /
  `nameArabic`; with an optional trailing ayah (`baqara 255`).
- `juz 3` (and a small alias map for common names — `juz amma` → 30,
  `tabarak` → 29); `hizb 5`; `rub 12`; `page 50` / `p 50`; `sajda` / `sajdah`
  → the 15 sajdah verses.
- bare `N` → surah if `1 ≤ N ≤ 114` (primary candidate), also offered as
  `page N` when `N ≤ 604` (secondary).
- Ambiguity is surfaced, not guessed: multiple candidates are returned, each
  labelled with cross-references (e.g. "Al-Baqarah 2:255 · Juz 3 · Page 42").

**Reverse lookup** (`src/nav/locate.ts`, pure): `juzOf`, `pageOf`, `hizbOf`,
`rubOf` — binary search over the sorted boundary arrays returning the
containing unit for a surah:ayah. Used by prev/next (PR1) and the position
display (PR2).

## PR 1 surfaces

- **Jump-to palette** — a `SuggestModal` (reusing the `QuranSearchModal`
  pattern in `suggest.ts`) fed by `resolveNav`. `renderSuggestion` shows label +
  sublabel; `onChooseSuggestion` → `navigateReaderTo(surah, ayah)`. New command
  **"Jump to…"** (`jump-to`). Optionally a ribbon entry.
- **In-reader prev/next** — a new reader-toolbar control **group**: surah ◀▶
  (surah ± 1, clamp 1..114, land on ayah 1) and juz ◀▶ (from the current ayah's
  juz via `juzOf`, go to the adjacent juz's start). Respects the existing
  toolbar Style-Settings hide-toggle pattern (a new `falah-reader-toolbar-nav`
  group + a `falah-hide-nav` body-class toggle, mirroring the existing groups).
- **Arabic-name selector tweak** — the toolbar surah `<option>` text gains the
  Arabic name (data already present in the core table): change
  `readerSurahOption(number, nameEnglish)` to also include `nameArabic` (e.g.
  "2 · Al-Baqarah · البقرة"); the i18n formatter takes the extra arg.

## PR 2 surfaces

- **Browse index** — a modal with tabs **Surahs · Juz · Pages · Sajdah**,
  each a scrollable list; tapping a row → `navigateReaderTo`. Shaped around the
  schemes the toolbar select can't do; a Surah tab is included for completeness
  but is the one place that overlaps the toolbar selector — kept minimal (it
  does not replace the always-visible dropdown). New command **"Browse
  Quran…"**. No Ruku tab (data exists, UI deferred).
- **Current-position display** — the reader header shows "Juz N · Page M" for
  the current surah's start via reverse lookup; subtle, and toggleable via a
  setting / Style-Settings class.

## No API / schema change

Navigation is internal; `navigateReaderTo` is already public.
`FALAH_API_VERSION` stays **6**; no `BOOKMARKS_VERSION` or store change.

## Interaction with existing surfaces (no duplication)

- The toolbar `<select>` stays the quick surah picker; palette/prev-next/browse
  add capabilities it lacks (other schemes, precise ayah, adjacent step, long
  lists) rather than repeating it.
- Page navigation lands at the page's **starting ayah within its surah** and
  scrolls there — the reader renders whole surahs, not mushaf pages. This is the
  intended behaviour, not an approximation to fix.

## Testing

Pure logic gets vitest (matching repo density):
- `resolveNav`: each query form (`2:255`, name + diacritics, `baqara 255`,
  `juz 3`, `juz amma`, `hizb`, `rub`, `page`, `sajda`, bare `N` ambiguity),
  ranking, and no-match.
- reverse lookup: `juzOf`/`pageOf`/`hizbOf` at boundary edges (first/last unit,
  exact boundary ayah, mid-unit).
- a data-integrity test over the bundled `quran-nav.json`: 30 juz / 60 hizb /
  240 rub / 604 pages / 15 sajdahs; arrays sorted; every entry's surah:ayah is
  in range; juz[0] and page[0] are 1:1.
The generation script and modals/reader-toolbar are obsidian/dev-side
(build-gated); the resolver and locate helpers are pure and fully unit-tested.

## Scope boundaries

**In (PR1+PR2):** the six addressing schemes' data + resolver + reverse lookup,
jump palette, in-reader surah/juz prev-next, the Arabic-name selector tweak,
browse index (Surahs/Juz/Pages/Sajdah), current-position display.
**Out (future):** ruku browse UI, mushaf-page *rendering* (page-based layout),
rub'/hizb browse tabs (jump palette covers them), audio/word-by-word (separate
roadmap stories).

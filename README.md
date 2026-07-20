# Falah

Quran and Hadith references, native to your Markdown notes. Clickable `falah://` links, a full Quran reader, slash-command lookup, and honorific glyphs — offline-first, desktop and mobile.

## What it does

- **`falah://` references.** Cite a verse or hadith anywhere in your vault (`falah://quran/2/255`, `falah://hadith/bukhari/1`) and it renders as a clickable chip. Click it to open the reference in a detail view, with a jump into the full reader from there. You rarely write these by hand — `/quran` and `/hadith` generate them for you.
- **Quran reader.** A dedicated reading view with Uthmani or IndoPak script, your choice of translation and tafsir, and adjustable fonts — pop it out into its own window if you like.
- **Slash-command lookup.** Type `/quran` or `/hadith` mid-sentence to search and insert a reference without leaving your note. `/` also completes honorific glyphs (ﷺ, ﷻ, رضي الله عنه, and others) by typing their transliteration.
- **Commands** for opening/popping out the reader, inserting a verse or hadith reference, inserting an honorific, opening the full detail view for the reference under your cursor, copying a reference as plain text, and refreshing a reference's cached text.
- **Offline-first.** Core Quran text ships bundled with the plugin. Additional translations, tafsirs, and hadith collections install on demand from Settings and are cached locally — no network needed once installed.
- **Companion API.** Other plugins can hook into Falah's reader and reference system (verse actions, ayah-row decorators, slash-menu entries) via a small public API — see [Tadabbur](https://github.com/zubayrali/obsidian-tadabbur) for reflection/journaling built entirely on it.

Everything Falah writes is plain Markdown (`falah://` links and `> [!quran]` callouts) — nothing proprietary, nothing stored outside your vault.

## Install

Until this is in the community plugin store:

1. Download `main.js`, `manifest.json`, and `styles.css` from this repo's latest release.
2. Put them in `<vault>/.obsidian/plugins/falah/`.
3. Reload Obsidian and enable **Falah** in Community Plugins.

## Settings

- **Display** — Arabic script (Uthmani/IndoPak), preferred translation and tafsir, font source and size.
- **Library** — browse and install additional translations, tafsirs, and hadith collections; manage what's already installed; scan the vault for existing references to import.
- **Hadith collections** — install/remove individual collections (Bukhari, Muslim, etc).
- **Online fallback** — optional translation/tafsir to fetch on demand for references you haven't installed locally.
- **Clear cache** — drop downloaded/cached data.

## Development

```bash
npm install
npm run dev    # watch build
npm test       # vitest
npm run lint   # eslint (obsidianmd community-review rules)
npm run build  # typecheck + production bundle
```

Falah exposes a versioned public API (`FALAH_API_VERSION`, currently 4) for companion plugins — see `src/api.ts`. Falah itself depends on no other plugin.

## License

MIT

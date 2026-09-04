# Changelog

All notable changes to Falah are documented here. Releases follow Semantic Versioning and use tags without a `v` prefix, as required by Obsidian.

## [0.2.0] - 2026-09-04

### Added

- Reading and Study modes with QCF4 Mushaf pages, synchronized recitation, page and surah navigation, font sizing, and theme-aware presentation.
- Word-by-word meanings, dictionary entries, morphology, grammar, and a configurable draggable inspector.
- Translation and tafsir comparison, localized surah titles, QUL surah-name typography, and Bismillah presentation.
- Streaming and offline recitation management, bookmarks, reading progress, offline Quran search, and rich navigation.
- Searchable download management for translations, tafsir, word data, recitations, and hadith collections.
- A versioned companion API used by Tadabbur.

### Changed

- Reorganized settings into compact Reader, Library, and Advanced areas.
- Improved mobile layouts, keyboard navigation, focus visibility, theme compatibility, and resource-operation feedback.
- Hardened resource downloads with progress, cancellation, atomic replacement, and live provider smoke tests.

### Fixed

- Translation-specific surah titles and transliteration fallback behavior.
- Reading-mode word selection, morphology access, recitation highlighting, context menus, and page navigation.
- Quran.com translation and tafsir endpoints and several hadith collection routes.

[0.2.0]: https://github.com/zubayrali/obsidian-falah/releases/tag/0.2.0

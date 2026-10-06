# Quran and hadith source audit — October 5, 2026

All configured public providers responded successfully after the fixes below. The expanded live audit recorded **951 passed checks, zero failures, and one authenticated-source skip**, reusing previously successful checks through its resume option. This verifies availability, adapter compatibility, and configuration; it does not certify the scholarly accuracy of each text or every verse of every remote edition.

## Coverage

| Source | Checked | Result |
| --- | --- | --- |
| Fawaz Quran CDN | All 492 catalog editions; chapter 1 normalized through the plugin adapter | Passed |
| AlQuran.cloud | All 118 text translations and 6 tafsirs; chapter probes, with rate-limited editions rechecked through the full-Quran transport used for installation | Passed |
| Quran.com / QUL adapter | All 126 translations and 20 tafsirs, chapter 1; additionally all 20 tafsirs paginated through chapter 2 | Passed, with upstream tafsir coverage gaps below |
| Fawaz hadith CDN | All 10 collections, all 64 advertised collection/language combinations, complete normalized collections | Passed |
| AhmedBaset hadith JSON | All 17 collections, 33 supported collection/language combinations, complete normalized collections | Passed after removing unavailable Darimi English |
| Open Hadith Data CSV | All 9 Arabic collections, complete parsed files | Passed |
| sunnah.com | Authentication gate; upstream route, header, response shape, and pagination reviewed; mocked contract tests | Authenticated live content unverified: no `SUNNAH_API_KEY` supplied to audit |
| Live hadith lookup | Arabic and English lookup for all 10 supported collections | Passed; Muslim uses record 3 because records 1 and 2 are empty upstream |
| Live Quran lookup/search | Default Arabic + English editions; English and Arabic search routes | Passed |
| EveryAyah recitations | All 13 reciters, URLs for 1:1, 2:286, and 114:6, HTTP status and audio MIME type | Passed |
| Quran word analysis | Actual corpus parser; Quran.com word normalizer for chapters 1, 2, and 114 | Passed |
| QCF Mushaf | Repository inventory contains every page 1–604; pages 1, 2, 300, and 604 parse correctly; their referenced font URLs respond | Passed |
| Bundled Quran | Actual shipped Uthmani, Indo-Pak, Clear Quran, and chapter metadata loaded through the real import map | Canonical 6,236 verse keys and nonempty text checked by regression test |
| Bundled Nawawi | Existing bundled collection and resolver tests | Passed |
| Core metadata build source | QUL `/api/v1/chapters` | HTTP 200 with chapter records |

Quran editions were sampled for reachability and normalization, rather than downloading every chapter of every edition. Hadith collection files were downloaded and normalized in full; language checks confirm each advertised language has content, but do not require every individual record to have a translation.

## Fixes

- Quran.com tafsir downloads now follow every `pagination.next_page`; previously only the first ten verses were saved. Invalid/repeating pagination is rejected.
- AlQuran.cloud's six audio-format entries are excluded from the text translation catalog.
- sunnah.com uses its upstream `/v1/hadiths?collection=…` route, follows catalog and content pagination, and no longer truncates at 200 pages. API keys are trimmed and still sent via `X-API-Key` by the runtime transport.
- AhmedBaset Darimi advertises Arabic only. A stale English catalog selection is rejected before downloading.
- Empty hadith placeholders are treated as misses in both installed-data resolution and live CDN lookup, allowing fallback or a missing-content error instead of a blank result.

## Upstream limitations

Even after fetching every Quran.com tafsir page, these resources expose fewer than 286 distinct verse keys for Al-Baqarah:

| Resource | Returned verse keys |
| --- | ---: |
| `qul-164`, Bengali Ibn Kathir | 173 |
| `qul-91`, Arabic Al-Sa'di | 282 |
| `qul-817`, English Tazkirul Quran | 138 |
| `qul-160`, Urdu Ibn Kathir | 180 |
| `qul-818`, Urdu Tazkir ul Quran | 79 |

These were the chapter endpoint's results before the targeted repair. The same resource's `by_ayah` endpoint exposes grouped passage coverage omitted by `by_chapter`. After implementing and live-testing this recovery across all 20 tafsirs, **19 cover all 286 ayahs**. Arabic Al-Sa'di (`qul-91`) still covers 282; its four missing targeted lookups are unavailable. The library records and displays these remaining gaps.

## Additional sources and follow-up fixes

- Added Quran Project English, Bengali, and Urdu downloads. All 114 chapters in each language passed actual adapter validation: **342 chapter/language checks**.
- Added Hadith Unlocked's 11 Arabic/English collections. All 11 complete offline exports normalized successfully; representative live lookups also passed, including suffix, compound, and explicit anthology references.
- Added exact hadith identity handling and live fallback, preserving chains, grades, and provider links. A suffixed reference never silently resolves to a different numeric narration.
- Grouped tafsir now resolves when a requested range begins inside a passage. Old Quran.com tafsir installations offer an adapter update after catalog loading; the old catalog cache is bypassed for this repair.
- `npm run check` passes release validation, lint (one existing settings-search advisory), automated tests, and production compilation. No authenticated Sunnah API verification or manual Obsidian UI test is claimed.

AlQuran.cloud initially returned HTTP 429 during the broad probe. Slower retries through its full-Quran endpoint succeeded. The reusable audit now spaces requests to that host and retries rate limits.

## Repeat the checks

```sh
npm run check
npm run test:apis
npm run test:apis:all -- --report=/tmp/falah-sources.json
# Also sample chapters 2 and 114 for every Quran resource:
npm run test:apis:all -- --deep --report=/tmp/falah-sources-deep.json
```

Supply `SUNNAH_API_KEY` in the environment to include authenticated sunnah.com collections. Reports never include the key. These commands test source data without writing to a vault. This audit reviewed repository defaults and runtime wiring; it did not inspect a particular vault's saved settings or manually exercise Obsidian's UI.

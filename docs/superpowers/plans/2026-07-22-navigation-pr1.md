# Navigation & Go-to — PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach any Quran location fast — bundled authoritative boundary data (juz/hizb/rub/page/sajdah/ruku), a pure resolver + reverse-lookup, a fuzzy **Jump to…** palette, in-reader **juz prev/next**, and an Arabic-name tweak to the surah selector.

**Architecture:** A checked-in generation script parses Tanzil's canonical metadata into a bundled `quran-nav.json` (runtime reads it, no new dependency). Pure, vitest-tested `resolve.ts` (query → ranked candidates) and `locate.ts` (surah:ayah → containing unit) live under `src/nav/`. A `SuggestModal` (mirroring `QuranSearchModal`) is the palette; the reader toolbar gains juz stepping. Navigation is internal — no API/schema change.

**Tech Stack:** TypeScript, Obsidian plugin API, vitest, a Node ESM generation script. Builds on `assets/bundled-core/surahs.json` (`registry.core.getSurahs()`), `src/suggest.ts` (`QuranSearchModal`), `src/reader.ts` (toolbar + `goSurah`/`navigateTo`), `src/main.ts` (`navigateReaderTo`), `src/data/core.ts` (`CoreLoader`).

Spec: [`../specs/2026-07-22-navigation-design.md`](../specs/2026-07-22-navigation-design.md) — this plan is **PR1**; browse index + position display are PR2.

## Global Constraints

- **No new *runtime* dependencies.** The generation script is dev-only (`scripts/`); any XML parsing/fetch stays there. The runtime only `import`s the produced JSON.
- **Boundary data must be authoritative** — parsed from Tanzil's `quran-data.xml` (or an equally canonical source), never hand-typed or model-generated. The generation script is checked in for reproducibility; a data-integrity test guards counts and ranges.
- **Pure modules import no `obsidian` runtime:** `src/nav/resolve.ts`, `src/nav/locate.ts` use `import type` only and take data as arguments (vitest-importable).
- **Reuse existing data:** surah names/matching come from the bundled core `Surah` table (`registry.core.getSurahs()`) — complete `nameArabic`/`nameEnglish`/`nameTransliterated`, independent of the installed translation. Never source surah names from a translation resource.
- **No API/schema change:** `FALAH_API_VERSION` stays **6**; no store/version bump. `navigateReaderTo(surah, ayah)` is the single navigation entry point.
- **Falah depends on no other plugin.** Tadabbur reference count stays **11**.
- New user-facing strings route through `t()` (en + ar short labels); new CSS uses Obsidian native vars only.
- Gate: `npm test`, `npm run lint` (0 errors), `npm run build` all pass.

## File Structure

- Create `scripts/gen-quran-nav.mjs` — dev generation script (fetch+parse Tanzil → JSON).
- Create `assets/bundled-core/quran-nav.json` — generated boundary data (committed).
- Create `src/nav/schema.ts` — the `QuranNav`/entry types (pure, shared).
- Create `src/nav/nav-data.test.ts` — data-integrity test over the bundled JSON.
- Create `src/nav/locate.ts` + `src/nav/locate.test.ts` — reverse lookup (pure).
- Create `src/nav/resolve.ts` + `src/nav/resolve.test.ts` — query resolver (pure).
- Modify `src/data/core.ts` — lazy-load `quran-nav.json` via `CoreLoader`.
- Create `src/nav/navigate-modal.ts` — the Jump-to `SuggestModal`.
- Modify `src/main.ts` — load nav data, `jump-to` command.
- Modify `src/reader.ts` — juz prev/next control group + Arabic name in the surah option.
- Modify `src/i18n/en.ts`, `src/i18n/ar.ts` — new keys + the surah-option formatter signature.
- Modify `styles.css` — nav toolbar group + hide toggle.

---

### Task 1: Bundled boundary data + generation script + integrity test

**Files:**
- Create: `scripts/gen-quran-nav.mjs`, `assets/bundled-core/quran-nav.json`, `src/nav/schema.ts`, `src/nav/nav-data.test.ts`

**Interfaces:**
- Produces `src/nav/schema.ts`:
```ts
export interface NavPoint { n: number; surah: number; ayah: number }
export interface Sajdah { surah: number; ayah: number; type: "recommended" | "obligatory" }
export interface QuranNav {
	juz: NavPoint[];    // 30
	hizb: NavPoint[];   // 60
	rub: NavPoint[];    // 240
	pages: NavPoint[];  // 604
	sajdahs: Sajdah[];  // 15
	ruku: NavPoint[];   // ~540 (data only, no UI in PR1)
}
```

- [ ] **Step 1: Write the generation script** — `scripts/gen-quran-nav.mjs`. It fetches Tanzil's canonical metadata and writes `assets/bundled-core/quran-nav.json`.

```js
// Dev-only. Parses Tanzil's quran-data.xml into assets/bundled-core/quran-nav.json.
// Run: node scripts/gen-quran-nav.mjs   (requires network once; output is committed).
// Source of truth: https://tanzil.net/res/text/metadata/quran-data.xml
import { writeFileSync } from "node:fs";

const URL = "https://tanzil.net/res/text/metadata/quran-data.xml";
const xml = await (await fetch(URL)).text();

// Tanzil uses attribute-only elements like <juz index="1" sura="1" aya="1"/>.
// INSPECT the fetched XML for the real element/attribute names before trusting
// these regexes — Tanzil groups juzs, quarters (rub' al-hizb, 240), pages,
// sajdas, rukus. Adjust the tag names below to match the actual document.
const grab = (tag, map) =>
	[...xml.matchAll(new RegExp(`<${tag}\\b[^>]*/>`, "g"))].map((m) => {
		const attr = (a) => (m[0].match(new RegExp(`${a}="([^"]*)"`)) ?? [])[1];
		return map(attr);
	});

const juz = grab("juz", (a) => ({ n: +a("index"), surah: +a("sura"), ayah: +a("aya") }));
const quarters = grab("quarter", (a) => ({ n: +a("index"), surah: +a("sura"), ayah: +a("aya") }));
const pages = grab("page", (a) => ({ n: +a("index"), surah: +a("sura"), ayah: +a("aya") }));
const ruku = grab("ruku", (a) => ({ n: +a("index"), surah: +a("sura"), ayah: +a("aya") }));
const sajdahs = grab("sajda", (a) => ({ surah: +a("sura"), ayah: +a("aya"), type: a("type") }));

// hizb = every 4th quarter (240 quarters → 60 hizbs); rub' = all 240 quarters.
const hizb = quarters.filter((_, i) => i % 4 === 0).map((q, i) => ({ n: i + 1, surah: q.surah, ayah: q.ayah }));

const nav = { juz, hizb, rub: quarters, pages, sajdahs, ruku };
// Fail loud if the parse produced the wrong shape (guards a schema change upstream).
const expect = { juz: 30, hizb: 60, rub: 240, pages: 604, sajdahs: 15 };
for (const [k, n] of Object.entries(expect))
	if (nav[k].length !== n) throw new Error(`gen-quran-nav: ${k} = ${nav[k].length}, expected ${n}`);

writeFileSync(new URL("../assets/bundled-core/quran-nav.json", import.meta.url), JSON.stringify(nav));
console.log("wrote quran-nav.json", Object.fromEntries(Object.entries(nav).map(([k, v]) => [k, v.length])));
```

- [ ] **Step 2: Run the script to produce the data**

Run: `node scripts/gen-quran-nav.mjs`
Expected: prints counts `{ juz: 30, hizb: 60, rub: 240, pages: 604, sajdahs: 15, ruku: … }` and writes `assets/bundled-core/quran-nav.json`.

> **If network/fetch is unavailable in this environment, or the Tanzil element names differ from the regexes above:** inspect the fetched XML, fix the tag/attribute names, and re-run. If you cannot fetch at all, STOP and report `NEEDS_CONTEXT` — the controller will supply the authoritative XML/JSON. Do NOT hand-author or approximate the boundary numbers.

- [ ] **Step 3: Write the schema + data-integrity test**

Create `src/nav/schema.ts` with the types above.

`src/nav/nav-data.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import nav from "../../assets/bundled-core/quran-nav.json";
import type { QuranNav } from "./schema";

const n = nav as unknown as QuranNav;

describe("bundled quran-nav.json integrity", () => {
	it("has the canonical counts", () => {
		expect(n.juz).toHaveLength(30);
		expect(n.hizb).toHaveLength(60);
		expect(n.rub).toHaveLength(240);
		expect(n.pages).toHaveLength(604);
		expect(n.sajdahs).toHaveLength(15);
		expect(n.ruku.length).toBeGreaterThan(500);
	});
	it("juz 1 and page 1 start at 1:1", () => {
		expect(n.juz[0]).toMatchObject({ surah: 1, ayah: 1 });
		expect(n.pages[0]).toMatchObject({ surah: 1, ayah: 1 });
	});
	it("every point is in range and arrays are sorted by position", () => {
		const ok = (s: number, a: number) => s >= 1 && s <= 114 && a >= 1 && a <= 286;
		const sorted = (arr: { surah: number; ayah: number }[]) =>
			arr.every((p, i) => i === 0 || p.surah > arr[i - 1].surah || (p.surah === arr[i - 1].surah && p.ayah >= arr[i - 1].ayah));
		for (const arr of [n.juz, n.hizb, n.rub, n.pages, n.ruku]) {
			expect(arr.every((p) => ok(p.surah, p.ayah))).toBe(true);
			expect(sorted(arr)).toBe(true);
		}
		expect(n.sajdahs.every((s) => ok(s.surah, s.ayah) && (s.type === "recommended" || s.type === "obligatory"))).toBe(true);
	});
});
```
(If `resolveJsonModule`/`import` of the JSON needs a `// @ts-expect-error` or an assertion, add it minimally — mirror how `surahs.json` is imported in `src/data/core.ts`.)

- [ ] **Step 4: Run the integrity test**

Run: `npx vitest run src/nav/nav-data.test.ts`
Expected: PASS (counts, 1:1 starts, ranges, sorted).

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-quran-nav.mjs assets/bundled-core/quran-nav.json src/nav/schema.ts src/nav/nav-data.test.ts
git commit -m "feat(nav): bundled Tanzil boundary data + generation script + integrity test"
```

---

### Task 2: Reverse lookup (pure)

**Files:** Create `src/nav/locate.ts`, `src/nav/locate.test.ts`

**Interfaces:**
- Consumes: `NavPoint`, `QuranNav` (schema).
- Produces:
  - `locatePoint(points: NavPoint[], surah: number, ayah: number): NavPoint | undefined` — the last point at/before (surah, ayah).
  - `juzOf(nav, surah, ayah)`, `pageOf(nav, surah, ayah)`, `hizbOf(nav, surah, ayah)`, `rubOf(nav, surah, ayah)` — return the containing `NavPoint` (or undefined before the first).

- [ ] **Step 1: Write the failing test** — `src/nav/locate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { locatePoint, juzOf, pageOf } from "./locate";
import type { QuranNav, NavPoint } from "./schema";

const pts = (xs: [number, number, number][]): NavPoint[] => xs.map(([n, surah, ayah]) => ({ n, surah, ayah }));
const nav = {
	juz: pts([[1, 1, 1], [2, 2, 142], [3, 2, 253]]),
	pages: pts([[1, 1, 1], [2, 1, 8], [3, 2, 1]]),
	hizb: [], rub: [], sajdahs: [], ruku: [],
} as unknown as QuranNav;

describe("locatePoint", () => {
	it("returns the last point at or before a position", () => {
		expect(locatePoint(nav.juz, 2, 200)).toMatchObject({ n: 2 }); // between juz 2 (2:142) and juz 3 (2:253)
		expect(locatePoint(nav.juz, 2, 253)).toMatchObject({ n: 3 }); // exact boundary → that unit
		expect(locatePoint(nav.juz, 1, 1)).toMatchObject({ n: 1 });   // first
	});
	it("returns undefined before the first point", () => {
		expect(locatePoint(pts([[1, 2, 1]]), 1, 1)).toBeUndefined();
	});
});

describe("juzOf / pageOf", () => {
	it("find the containing unit", () => {
		expect(juzOf(nav, 2, 253)?.n).toBe(3);
		expect(pageOf(nav, 1, 9)?.n).toBe(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/nav/locate.test.ts`
Expected: FAIL — cannot resolve `./locate`.

- [ ] **Step 3: Write minimal implementation** — `src/nav/locate.ts`:

```ts
// Pure reverse lookup: which juz/page/hizb/rub contains a surah:ayah.
// Binary search over position-sorted NavPoint arrays. No "obsidian" import.
import type { NavPoint, QuranNav } from "./schema";

const cmp = (surah: number, ayah: number, p: NavPoint) =>
	surah !== p.surah ? surah - p.surah : ayah - p.ayah;

/** The last point at or before (surah, ayah); undefined if before the first. */
export function locatePoint(points: NavPoint[], surah: number, ayah: number): NavPoint | undefined {
	let lo = 0, hi = points.length - 1, ans: NavPoint | undefined;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (cmp(surah, ayah, points[mid]) >= 0) { ans = points[mid]; lo = mid + 1; }
		else hi = mid - 1;
	}
	return ans;
}

export const juzOf = (nav: QuranNav, s: number, a: number) => locatePoint(nav.juz, s, a);
export const pageOf = (nav: QuranNav, s: number, a: number) => locatePoint(nav.pages, s, a);
export const hizbOf = (nav: QuranNav, s: number, a: number) => locatePoint(nav.hizb, s, a);
export const rubOf = (nav: QuranNav, s: number, a: number) => locatePoint(nav.rub, s, a);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/nav/locate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nav/locate.ts src/nav/locate.test.ts
git commit -m "feat(nav): pure reverse-lookup (juz/page/hizb/rub of a position)"
```

---

### Task 3: Query resolver (pure)

**Files:** Create `src/nav/resolve.ts`, `src/nav/resolve.test.ts`

**Interfaces:**
- Consumes: `Surah` (`../data/schema`), `QuranNav` (`./schema`).
- Produces:
  - `interface NavCandidate { surah: number; ayah: number; label: string; sublabel?: string; kind: "ayah"|"surah"|"juz"|"hizb"|"rub"|"page"|"sajdah" }`
  - `resolveNav(query: string, surahs: Surah[], nav: QuranNav): NavCandidate[]`
  - `normalizeName(s: string): string` (exported for tests) — lowercase, strip Arabic diacritics + Latin diacritics, drop non-alphanumerics.

- [ ] **Step 1: Write the failing test** — `src/nav/resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveNav, normalizeName } from "./resolve";
import type { Surah } from "../data/schema";
import type { QuranNav, NavPoint } from "./schema";

const surahs: Surah[] = [
	{ number: 1, nameArabic: "الفاتحة", nameEnglish: "The Opener", nameTransliterated: "Al-Fatihah", ayahCount: 7, revelationPlace: "makkah" },
	{ number: 2, nameArabic: "البقرة", nameEnglish: "The Cow", nameTransliterated: "Al-Baqarah", ayahCount: 286, revelationPlace: "madinah" },
];
const pt = (n: number, s: number, a: number): NavPoint => ({ n, surah: s, ayah: a });
const nav = {
	juz: [pt(1, 1, 1), pt(2, 2, 142), pt(3, 2, 253)],
	pages: [pt(1, 1, 1), pt(50, 2, 253)],
	hizb: [pt(1, 1, 1)], rub: [pt(1, 1, 1)],
	sajdahs: [{ surah: 7, ayah: 206, type: "recommended" as const }],
	ruku: [],
} as unknown as QuranNav;

const first = (q: string) => resolveNav(q, surahs, nav)[0];

describe("resolveNav", () => {
	it("surah:ayah", () => expect(first("2:255")).toMatchObject({ surah: 2, ayah: 255, kind: "ayah" }));
	it("surah name (diacritics/hyphen-insensitive)", () => {
		expect(first("baqara")).toMatchObject({ surah: 2, ayah: 1, kind: "surah" });
		expect(first("al-baqarah")).toMatchObject({ surah: 2 });
		expect(first("البقرة")).toMatchObject({ surah: 2 });
	});
	it("surah name + ayah", () => expect(first("baqara 255")).toMatchObject({ surah: 2, ayah: 255 }));
	it("juz number and name", () => {
		expect(first("juz 3")).toMatchObject({ surah: 2, ayah: 253, kind: "juz" });
		expect(first("juz amma")).toMatchObject({ kind: "juz" }); // 30 (not in fixture nav → still a juz candidate if within data; here fixture has 3 juz, so expect no crash)
	});
	it("page", () => expect(first("page 50")).toMatchObject({ surah: 2, ayah: 253, kind: "page" }));
	it("sajda lists the sajdah verses", () => {
		const c = resolveNav("sajda", surahs, nav);
		expect(c.some((x) => x.kind === "sajdah" && x.surah === 7 && x.ayah === 206)).toBe(true);
	});
	it("bare N is a surah (primary) and offered as a page (secondary)", () => {
		const c = resolveNav("2", surahs, nav);
		expect(c[0]).toMatchObject({ surah: 2, kind: "surah" });
		expect(c.some((x) => x.kind === "page")).toBe(true);
	});
	it("empty / no match → []", () => {
		expect(resolveNav("", surahs, nav)).toEqual([]);
		expect(resolveNav("zzzz", surahs, nav)).toEqual([]);
	});
});

describe("normalizeName", () => {
	it("strips diacritics, hyphens, case", () => {
		expect(normalizeName("Al-Baqarah")).toBe(normalizeName("albaqarah"));
		expect(normalizeName("البَقَرة")).toContain("البقرة".slice(0, 3)); // diacritics stripped
	});
});
```
(Adjust the `juz amma` assertion to your fixture — the point is the parser recognises the `juz <name>` form; if 30 isn't in the small fixture, resolve it against `nav.juz` length safely and simply assert `kind: "juz"` is produced for a recognised alias, or drop that line if it over-constrains the fixture.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/nav/resolve.test.ts`
Expected: FAIL — cannot resolve `./resolve`.

- [ ] **Step 3: Write minimal implementation** — `src/nav/resolve.ts`:

```ts
// Pure query resolver: a typed query → ranked navigation candidates. No
// "obsidian" import. Surah names/matching come from the passed core Surah table.
import type { Surah } from "../data/schema";
import type { QuranNav, NavPoint } from "./schema";

export interface NavCandidate {
	surah: number;
	ayah: number;
	label: string;
	sublabel?: string;
	kind: "ayah" | "surah" | "juz" | "hizb" | "rub" | "page" | "sajdah";
}

/** Common juz nicknames → juz number. */
const JUZ_ALIASES: Record<string, number> = { amma: 30, tabarak: 29 };

const ARABIC_DIACRITICS = /[ً-ْٰ]/g;
export function normalizeName(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")   // Latin diacritics
		.replace(ARABIC_DIACRITICS, "")     // Arabic harakat
		.toLowerCase()
		.replace(/[^a-z0-9؀-ۿ]/g, ""); // drop spaces/hyphens/punct
}

const point = (arr: NavPoint[], n: number) => arr.find((p) => p.n === n);

export function resolveNav(query: string, surahs: Surah[], nav: QuranNav): NavCandidate[] {
	const q = query.trim();
	if (!q) return [];
	const out: NavCandidate[] = [];
	const surahLabel = (n: number) => surahs.find((s) => s.number === n)?.nameTransliterated ?? `Surah ${n}`;

	// 2:255
	const ref = /^(\d{1,3}):(\d{1,3})$/.exec(q);
	if (ref) {
		const surah = +ref[1], ayah = +ref[2];
		if (surah >= 1 && surah <= 114) return [{ surah, ayah, kind: "ayah", label: `${surahLabel(surah)} ${surah}:${ayah}` }];
	}

	// scheme keywords: juz/hizb/rub/page N (or juz <alias>)
	const kw = /^(juz|hizb|rub|page|p)\s+(\w+)$/i.exec(q);
	if (kw) {
		const scheme = kw[1].toLowerCase() === "p" ? "page" : kw[1].toLowerCase();
		const raw = kw[2].toLowerCase();
		const num = /^\d+$/.test(raw) ? +raw : JUZ_ALIASES[raw];
		const arr = scheme === "page" ? nav.pages : scheme === "juz" ? nav.juz : scheme === "hizb" ? nav.hizb : nav.rub;
		const p = num ? point(arr, num) : undefined;
		if (p) return [{ surah: p.surah, ayah: p.ayah, kind: scheme as NavCandidate["kind"], label: `${scheme[0].toUpperCase()}${scheme.slice(1)} ${p.n}`, sublabel: `${surahLabel(p.surah)} ${p.surah}:${p.ayah}` }];
	}

	// sajda → list the sajdah verses
	if (/^saj?da[h]?$/i.test(q)) {
		return nav.sajdahs.map((s) => ({ surah: s.surah, ayah: s.ayah, kind: "sajdah", label: `Sajdah — ${surahLabel(s.surah)} ${s.surah}:${s.ayah}`, sublabel: s.type }));
	}

	// surah name (+ optional ayah): "baqara", "al-baqarah 255", "البقرة"
	const nameAyah = /^(.*?)(?:\s+(\d{1,3}))?$/.exec(q);
	const namePart = nameAyah?.[1] ?? q;
	const ayahPart = nameAyah?.[2] ? +nameAyah[2] : undefined;
	const nq = normalizeName(namePart);
	if (nq) {
		for (const s of surahs) {
			const hit = [s.nameTransliterated, s.nameEnglish, s.nameArabic].some((nm) => {
				const nn = normalizeName(nm);
				return nn === nq || nn.includes(nq) || nq.includes(nn);
			});
			if (hit) {
				const ayah = ayahPart ?? 1;
				out.push({ surah: s.number, ayah, kind: ayahPart ? "ayah" : "surah", label: `${s.nameTransliterated} ${s.number}${ayahPart ? `:${ayah}` : ""}`, sublabel: s.nameArabic });
			}
		}
	}

	// bare N → surah (primary) + page (secondary)
	if (/^\d{1,3}$/.test(q)) {
		const n = +q;
		if (n >= 1 && n <= 114 && !out.some((c) => c.surah === n && c.kind === "surah")) {
			out.unshift({ surah: n, ayah: 1, kind: "surah", label: `${surahLabel(n)} ${n}`, sublabel: surahs.find((s) => s.number === n)?.nameArabic });
		}
		const pg = point(nav.pages, n);
		if (pg) out.push({ surah: pg.surah, ayah: pg.ayah, kind: "page", label: `Page ${n}`, sublabel: `${surahLabel(pg.surah)} ${pg.surah}:${pg.ayah}` });
	}

	return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/nav/resolve.test.ts`
Expected: PASS. (If the `juz amma` fixture line over-constrains, relax it per the Step-1 note.)

- [ ] **Step 5: Commit**

```bash
git add src/nav/resolve.ts src/nav/resolve.test.ts
git commit -m "feat(nav): pure query resolver (ayah/name/juz/hizb/rub/page/sajda)"
```

---

### Task 4: Load nav data via CoreLoader

**Files:** Modify `src/data/core.ts`; add a small test to `src/data/core.test.ts`

**Interfaces:**
- Produces: `CoreLoader.getNav(): Promise<QuranNav>` — lazy-imports `assets/bundled-core/quran-nav.json`, mirroring the existing `getSurahs()` (`src/data/core.ts:74,89`).

- [ ] **Step 1: Add the loader** — in `src/data/core.ts`, mirror the surahs plumbing:
  - Add to the imports interface: `nav: () => Promise<JsonModule<QuranNav>>;`
  - Add a cached field `private nav?: Promise<QuranNav>;`
  - Add `getNav(): Promise<QuranNav> { return (this.nav ??= this.imports.nav().then(unwrap)); }`
  - In the default imports map (near `surahs: () => import("../../assets/bundled-core/surahs.json") …`), add:
    `nav: () => import("../../assets/bundled-core/quran-nav.json") as unknown as Promise<{ default: QuranNav }>,`
  - Import the type: `import type { QuranNav } from "../nav/schema";`

- [ ] **Step 2: Add a loader test** — in `src/data/core.test.ts`, extend the existing fake imports with a `nav` stub and assert `getNav()` returns it and is cached (called once). Follow the existing `surahs`/`getSurahs` test pattern in that file.

- [ ] **Step 3: Verify**

Run: `npx vitest run src/data/core.test.ts` then `npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/data/core.ts src/data/core.test.ts
git commit -m "feat(nav): lazy-load bundled quran-nav via CoreLoader"
```

---

### Task 5: Jump-to palette + command

**Files:** Create `src/nav/navigate-modal.ts`; modify `src/main.ts`, `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `resolveNav`/`NavCandidate` (Task 3), `CoreLoader.getSurahs`/`getNav` (Task 4), `navigateReaderTo` (main).
- Produces: `class NavigateModal extends SuggestModal<NavCandidate>`; a `jump-to` command.

- [ ] **Step 1: Create the modal** — `src/nav/navigate-modal.ts`, mirroring `QuranSearchModal` (`src/suggest.ts`):

```ts
import { SuggestModal } from "obsidian";
import type FalahPlugin from "../main";
import { t } from "../i18n";
import { resolveNav, type NavCandidate } from "./resolve";
import type { Surah } from "../data/schema";
import type { QuranNav } from "./schema";

export class NavigateModal extends SuggestModal<NavCandidate> {
	private surahs: Surah[] = [];
	private nav?: QuranNav;
	constructor(private plugin: FalahPlugin) {
		super(plugin.app);
		this.setPlaceholder(t().navJumpPlaceholder);
		void Promise.all([plugin.registry.core.getSurahs(), plugin.registry.core.getNav()])
			.then(([s, n]) => { this.surahs = s; this.nav = n; });
	}
	getSuggestions(query: string): NavCandidate[] {
		if (!this.nav) return [];
		return resolveNav(query, this.surahs, this.nav);
	}
	renderSuggestion(c: NavCandidate, el: HTMLElement): void {
		el.createDiv({ cls: "falah-suggest-title", text: c.label });
		if (c.sublabel) el.createDiv({ cls: "falah-suggest-snippet", text: c.sublabel });
	}
	onChooseSuggestion(c: NavCandidate): void {
		this.plugin.navigateReaderTo(c.surah, c.ayah);
	}
}
```

- [ ] **Step 2: Add the command + i18n** — in `src/main.ts`:
```ts
this.addCommand({ id: "jump-to", name: t().cmdJumpTo, callback: () => new NavigateModal(this).open() });
```
Import `NavigateModal`. Add en keys `cmdJumpTo: "Jump to…"`, `navJumpPlaceholder: "Jump to a surah, ayah, juz, page… (e.g. 2:255, baqara, juz 3, page 50)"`; ar short label `cmdJumpTo`.

- [ ] **Step 3: Verify**

Run: `npm run build` then `npm test`
Expected: both pass. Manually: run "Jump to…", type `2:255` / `baqara` / `juz 3` / `page 50`, choose → the reader opens at the right ayah.

- [ ] **Step 4: Commit**

```bash
git add src/nav/navigate-modal.ts src/main.ts src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(nav): Jump to… palette command"
```

---

### Task 6: In-reader juz prev/next + Arabic-name in surah selector

**Files:** Modify `src/reader.ts`, `src/i18n/en.ts`, `src/i18n/ar.ts`, `styles.css`

**Interfaces:**
- Consumes: `juzOf`/`locatePoint` (Task 2), `CoreLoader.getNav` (Task 4), the reader's `goSurah`/`navigateTo`.

Note: the toolbar already has **surah** prev/next (`src/reader.ts:181-197`, around `goSurah`). This task adds **juz** prev/next and the Arabic-name option tweak.

- [ ] **Step 1: Arabic name in the surah option** — change the option text and the formatter:
  - In `src/reader.ts:189`, pass the Arabic name: `text: strings.readerSurahOption(s.number, s.nameEnglish, s.nameArabic)`.
  - In `src/i18n/en.ts`, update `readerSurahOption` to `(n: number, en: string, ar: string) => \`${n} · ${en} · ${ar}\`` (keep its existing key name; add the `ar` param). Update `src/i18n/ar.ts` if it overrides this key (mirror the new signature) — otherwise the en formatter is used.

- [ ] **Step 2: Juz prev/next control group** — in `buildToolbar` (after the existing surah `navGroup`), add a juz group. Load nav once (cache on the view, e.g. `this.nav ??= await this.plugin.registry.core.getNav()` — fetch it in `render()` alongside surahs and pass it in, mirroring how `surahs`/`resources` are fetched at `src/reader.ts:160`). Then:

```ts
const juzGroup = controls.createDiv({ cls: "falah-reader-toolbar-group falah-reader-toolbar-nav" });
const cur = juzOf(nav, this.state.surah, this.currentAyah()); // see Step 3
const jprev = juzGroup.createEl("button", { text: strings.readerJuzPrev, cls: "falah-reader-btn" });
jprev.disabled = !cur || cur.n <= 1;
jprev.onclick = () => { const p = nav.juz[(cur!.n - 1) - 1]; if (p) this.navigateTo(p.surah, p.ayah); };
juzGroup.createSpan({ cls: "falah-reader-juz-label", text: strings.readerJuzLabel(cur?.n ?? 1) });
const jnext = juzGroup.createEl("button", { text: strings.readerJuzNext, cls: "falah-reader-btn" });
jnext.disabled = !cur || cur.n >= 30;
jnext.onclick = () => { const p = nav.juz[(cur!.n - 1) + 1]; if (p) this.navigateTo(p.surah, p.ayah); };
```
Add i18n: `readerJuzPrev: "‹ Juz"`, `readerJuzNext: "Juz ›"`, `readerJuzLabel: (n: number) => \`Juz ${n}\`` (en; ar short labels for the two buttons + label).

- [ ] **Step 3: Current-ayah helper** — add a small `private currentAyah(): number` to the reader returning the best-known current ayah (if the reader tracks a scroll/selected ayah in `this.state`, use it; otherwise return `1`). Keep it simple — juz stepping from the surah's start is acceptable for v1; a precise scroll-based current ayah is PR2/Reading-Progress territory. If `this.state` has no ayah field, `return 1;` and compute juz from `(this.state.surah, 1)`.

- [ ] **Step 4: CSS + hide toggle** — append to `styles.css`: style `.falah-reader-toolbar-nav` (match the other toolbar groups) and `.falah-reader-juz-label` (muted). Add a Style-Settings hide toggle mirroring the existing ones: a `body.falah-hide-nav .falah-reader-toolbar-nav { display: none; }` rule and a corresponding `@settings` entry + a `readerHideNav` boolean setting wired like the other `readerHide*` toggles in `main.ts` (follow the exact pattern of `readerHidePopout`).

- [ ] **Step 5: Verify**

Run: `npm test`, `npm run lint` (0 errors), `npm run build` (all pass). Manually: the surah dropdown shows "2 · The Cow · البقرة"; juz ‹ › step to adjacent juz starts and the label updates; the hide toggle hides the nav group.

- [ ] **Step 6: Commit**

```bash
git add src/reader.ts src/i18n/en.ts src/i18n/ar.ts styles.css
git commit -m "feat(nav): in-reader juz prev/next + Arabic name in surah selector"
```

---

### Task 7: Full green + invariant recheck

**Files:** none (verification).

- [ ] **Step 1: Full gate** — Run: `npm test && npm run lint && npm run build` — all pass (lint 0 errors).

- [ ] **Step 2: Invariants**
```bash
grep -rc "TADABBUR\|Tadabbur\|tadabbur" src/ | grep -v ':0' | awk -F: '{s+=$2} END {print s}'   # expect 11
grep -n "FALAH_API_VERSION = " src/api.ts                                                        # expect 6 (unchanged)
node -e "const n=require('./assets/bundled-core/quran-nav.json'); console.log(n.juz.length,n.hizb.length,n.rub.length,n.pages.length,n.sajdahs.length)"  # 30 60 240 604 15
```

- [ ] **Step 3: Manual acceptance (PR1 scope)**
- "Jump to…" resolves `2:255`, `baqara`, `al-baqarah 255`, `البقرة`, `juz 3`, `juz amma`, `hizb 5`, `page 50`, `sajda`, and bare `2` (surah + page candidates) — each opens the reader at the correct ayah.
- Surah dropdown shows the Arabic name; juz ‹ › step correctly and disable at 1/30.
- Boundary data is authoritative (counts 30/60/240/604/15; the generation script reproduces the committed JSON).

- [ ] **Step 4: Finish** — Commit any fixes, then use the finishing-a-development-branch skill (merge to master per the established pattern).

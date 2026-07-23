// Dev-only. Parses Tanzil's quran-data.xml into assets/bundled-core/quran-nav.json.
// Run: node scripts/gen-quran-nav.mjs   (requires network once; output is committed).
// Source of truth: https://tanzil.net/res/text/metadata/quran-data.xml
import { writeFileSync } from "node:fs";

const SOURCE_URL = "https://tanzil.net/res/text/metadata/quran-data.xml";
const xml = await (await fetch(SOURCE_URL)).text();

// Tanzil uses attribute-only elements like <juz index="1" sura="1" aya="1"/>.
// Verified against the live document (2026-07-22): juzs -> <juz>, hizbs -> <quarter>
// (240 quarter elements, grouped 4-per-hizb), pages -> <page>, sajdas -> <sajda>,
// rukus -> <ruku>. There is no standalone <hizb> or <rub> element; hizb boundaries
// are derived from every 4th quarter below.
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
if (nav.ruku.length < 500) throw new Error(`gen-quran-nav: ruku = ${nav.ruku.length}, expected >500`);

writeFileSync(new URL("../assets/bundled-core/quran-nav.json", import.meta.url), JSON.stringify(nav));
console.log("wrote quran-nav.json", Object.fromEntries(Object.entries(nav).map(([k, v]) => [k, v.length])));

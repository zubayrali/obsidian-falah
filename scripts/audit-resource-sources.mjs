// Live contract audit using the same adapters as the plugin. No vault writes.
// npm run test:apis:all -- --report=/tmp/falah-sources.json
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/data/download"; export * from "./src/data/hadith/sources"; export * from "./src/data/quran-project"; export * from "./src/data/hadith/unlocked"; export { RECITERS } from "./src/audio/recitation"; export { parseQcfPage, qcfFontFile } from "./src/qcf/schema"; export { parseCorpusMorphology, normalizeQuranComWords } from "./src/word-by-word/download";',
		resolveDir: process.cwd(),
	},
	bundle: true, platform: "node", format: "esm", write: false,
});
const adapters = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const results = [];
const jobs = [];
const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9);
const resumePath = process.argv.find((arg) => arg.startsWith("--resume="))?.slice(9);
const prior = resumePath ? JSON.parse(await readFile(resumePath, "utf8")).results : [];
const deep = process.argv.includes("--deep");
let cloudQueue = Promise.resolve();
const request = async (url, headers) => {
	if (url.includes("api.alquran.cloud")) {
		const previous = cloudQueue;
		cloudQueue = previous.then(() => delay(2000));
		await cloudQueue;
	}
	let response;
	for (let attempt = 0; attempt < 3; attempt++) {
		response = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) });
		if (response.status !== 429 || attempt === 2) break;
		await delay(Math.min(60, Number(response.headers.get("retry-after")) || 20) * 1000);
	}
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
	return url.endsWith(".csv") ? response.text() : response.json();
};
const check = async (name, run) => {
	const previous = prior.find((entry) => entry.name === name && entry.status === "passed");
	if (previous && !deep && !name.endsWith("catalogue")) { results.push(previous); return; }
	try {
		const detail = await run();
		results.push({ name, status: "passed", detail });
	} catch (error) {
		results.push({ name, status: "failed", error: error.message });
		console.error(`FAIL ${name}: ${error.message}`);
	}
};
for (const source of [new adapters.Fawazahmed0Source(request), new adapters.AlQuranCloudSource(request), new adapters.QulSource(request), new adapters.QuranProjectSource()]) {
	for (const type of ["translation", "tafsir"]) {
		await check(`${source.id} ${type} catalogue`, async () => {
			const catalog = await source.listCatalog(type);
			for (const desc of catalog) jobs.push({ name: `${desc.id} ${type}`, run: async () => {
				const chapters = [];
				// Exercise the bulk transport the plugin uses for AlQuran.cloud.
				const bulk = source.fetchAllSurahs ? await source.fetchAllSurahs(desc, request) : undefined;
				for (const [surah, count] of deep ? [[1, 7], [2, 286], [114, 6]] : [[1, 7]]) {
					const rows = bulk ? bulk.get(surah) ?? [] : await source.fetchSurah(desc, surah, count, request);
					if (!rows.length || rows.some((row) => !row.text.trim())) throw new Error(`Chapter ${surah}: empty content`);
					chapters.push({ surah, rows: rows.length });
				}
				return chapters;
			} });
			return { resources: catalog.length };
		});
	}
}
const sunnahKey = process.env.SUNNAH_API_KEY?.trim();
const hadithSources = [new adapters.Fawazahmed0HadithSource(), new adapters.AhmedBasetHadithSource(), new adapters.OpenHadithCsvSource(), new adapters.HadithUnlockedSource()];
if (sunnahKey) hadithSources.push(new adapters.SunnahComHadithSource(() => sunnahKey, (url, key) => request(url, { "X-API-Key": key })));
else results.push({ name: "sunnah.com authenticated content", status: "skipped", reason: "Set SUNNAH_API_KEY to verify authenticated collections." });
for (const source of hadithSources) {
	await check(`${source.id} hadith catalogue`, async () => {
		const catalog = await source.listCatalog(request);
		if (!catalog.length) throw new Error("Empty catalogue");
		for (const desc of catalog) for (const language of desc.languages) jobs.push({ name: `${source.id} ${desc.collection} ${language}`, run: async () => {
			const data = await source.fetchCollection(desc.collection, language, request);
			if (!data.hadiths.length) throw new Error("Empty normalized collection");
			const arabic = data.hadiths.filter((h) => h.arabic?.trim()).length;
			const translations = data.hadiths.filter((h) => h.translation?.trim()).length;
			if (!arabic || (language !== "ara" && !translations)) throw new Error("Selected language has no content");
			return { hadiths: data.hadiths.length, arabic, translations };
		} });
		return { collections: catalog.length };
	});
}
let cursor = 0;
for (const { collection } of await new adapters.Fawazahmed0HadithSource().listCatalog(request)) {
	for (const language of ["ara", "eng"]) jobs.push({ name: `Live hadith ${collection} ${language}`, run: async () => {
		// Muslim 1 and 2 are empty placeholders in this upstream dataset.
		const number = collection === "muslim" ? 3 : 1;
		const json = await request(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${language}-${collection}/${number}.json`);
		if (!json.hadiths?.[0]?.text?.trim()) throw new Error("Empty hadith lookup");
		return { number };
	} });
}
for (const { collection } of await new adapters.HadithUnlockedSource().listCatalog()) jobs.push({ name: `Hadith Unlocked live ${collection}`, run: async () => {
	const number = collection === "muslim" ? "8a" : collection === "malik" ? "1-1" : "1";
	const content = await new adapters.HadithUnlockedProvider(request).getHadith({ kind: "hadith", collection, number });
	return { number, arabic: Boolean(content.arabic), translation: Boolean(content.translation), url: content.externalUrl };
} });
for (const reciter of adapters.RECITERS) jobs.push({ name: `Recitation ${reciter.id}`, run: async () => {
	for (const verse of ["001001", "002286", "114006"]) {
		const response = await fetch(`${reciter.baseUrl}/${verse}.mp3`, { method: "HEAD", signal: AbortSignal.timeout(25_000) });
		if (!response.ok || !response.headers.get("content-type")?.includes("audio")) throw new Error(`${verse}: HTTP ${response.status} or invalid audio type`);
	}
	return { verses: ["1:1", "2:286", "114:6"] };
} });
jobs.push({ name: "Quran word meanings and morphology", run: async () => {
	const response = await fetch("https://raw.githubusercontent.com/cltk/arabic_morphology_quranic-corpus/master/quranic-corpus-morphology-0.4.txt", { signal: AbortSignal.timeout(45_000) });
	if (!response.ok) throw new Error(`Morphology: HTTP ${response.status}`);
	const morphology = adapters.parseCorpusMorphology(await response.text());
	if (!morphology.size) throw new Error("Empty morphology");
	for (const [surah, count] of [[1, 7], [2, 286], [114, 6]]) {
		const json = await request(`https://api.quran.com/api/v4/verses/by_chapter/${surah}?language=en&words=true&word_fields=text_uthmani,transliteration,translation&per_page=300&page=1`);
		if (adapters.normalizeQuranComWords(json, morphology).length !== count) throw new Error(`Chapter ${surah}: incomplete word data`);
	}
	return { morphologyWords: morphology.size };
} });
jobs.push({ name: "QCF Mushaf pages and fonts", run: async () => {
	const tree = await request("https://api.github.com/repos/MohamadHajjRabee/quran-qcf4/git/trees/main?recursive=1");
	if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("Incomplete repository inventory");
	const paths = new Set(tree.tree.map((entry) => entry.path));
	for (let page = 1; page <= 604; page++) {
		if (!paths.has(`pages/${String(page).padStart(3, "0")}.json`)) throw new Error(`Missing page ${page}`);
	}
	const fonts = new Set();
	for (const number of [1, 2, 300, 604]) {
		const json = await request(`https://raw.githubusercontent.com/MohamadHajjRabee/quran-qcf4/main/pages/${String(number).padStart(3, "0")}.json`);
		const page = adapters.parseQcfPage(json, number);
		fonts.add(page.font);
		for (const line of page.lines) for (const word of line.words) fonts.add(word.font);
	}
	for (const font of fonts) {
		const response = await fetch(`https://cdn.jsdelivr.net/gh/MohamadHajjRabee/quran-qcf4@main/fonts-woff2/${adapters.qcfFontFile(font)}`, { method: "HEAD", signal: AbortSignal.timeout(25_000) });
		if (!response.ok) throw new Error(`Font ${font}: HTTP ${response.status}`);
	}
	return { pageFiles: 604, sampledPages: [1, 2, 300, 604], sampledFonts: [...fonts] };
} });
await Promise.all(Array.from({ length: 3 }, async () => {
	while (cursor < jobs.length) {
		const job = jobs[cursor++];
		await check(job.name, job.run);
		if (reportPath) await writeFile(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
		if (cursor % 25 === 0) console.log(`Checked ${cursor}/${jobs.length} resources`);
	}
}));
const report = { checkedAt: new Date().toISOString(), scope: `Every catalogue resource: Quran chapters ${deep ? "1, 2, 114" : "1"} (AlQuran.cloud bulk transport); complete hadith collections in every advertised language`, results };
if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: results.filter((r) => r.status === "passed").length, failed: results.filter((r) => r.status === "failed").length, skipped: results.filter((r) => r.status === "skipped").length }));
if (results.some((r) => r.status === "failed")) process.exitCode = 1;

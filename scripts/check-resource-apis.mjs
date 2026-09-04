const TIMEOUT_MS = 25_000;

async function request(name, url, validate, options = {}) {
	const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...options });
	if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
	const value = options.method === "HEAD" ? response : await response.json();
	if (validate && !validate(value)) throw new Error(`${name}: response shape changed`);
	console.log(`✓ ${name} (${response.status})`);
	return value;
}

const fawazQuran = await request(
	"Fawaz Quran catalogue",
	"https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions.json",
	(value) => value && typeof value === "object" && Object.keys(value).length > 0,
);
await request(
	"Fawaz Quran chapter",
	"https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/eng-ahmedali/1.json",
	(value) => Array.isArray(value?.chapter) && value.chapter.length === 7,
);

await request(
	"AlQuran.cloud catalogue",
	"https://api.alquran.cloud/v1/edition",
	(value) => value?.code === 200 && Array.isArray(value?.data),
);
await request(
	"AlQuran.cloud chapter",
	"https://api.alquran.cloud/v1/surah/1/en.sahih",
	(value) => value?.code === 200 && Array.isArray(value?.data?.ayahs),
);

const qulTranslations = await request(
	"Quran.com translation catalogue",
	"https://api.quran.com/api/v4/resources/translations",
	(value) => Array.isArray(value?.translations) && value.translations.length > 0,
);
const qulTafsirs = await request(
	"Quran.com tafsir catalogue",
	"https://api.quran.com/api/v4/resources/tafsirs",
	(value) => Array.isArray(value?.tafsirs) && value.tafsirs.length > 0,
);
await request(
	"Quran.com translation chapter",
	`https://api.quran.com/api/v4/quran/translations/${qulTranslations.translations[0].id}?chapter_number=1&fields=verse_key`,
	(value) => Array.isArray(value?.translations) && value.translations.length === 7,
);
await request(
	"Quran.com tafsir chapter",
	`https://api.quran.com/api/v4/tafsirs/${qulTafsirs.tafsirs[0].id}/by_chapter/1`,
	(value) => Array.isArray(value?.tafsirs) && value.tafsirs.length > 0,
);

const fawazHadith = await request(
	"Fawaz Hadith catalogue",
	"https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions.json",
	(value) => value && typeof value === "object" && Object.keys(value).length > 0,
);
const sampleHadithEdition = Object.values(fawazHadith)
	.flatMap((entry) => Array.isArray(entry?.collection) ? entry.collection : [])
	.find((entry) => typeof entry?.name === "string" && entry.name.startsWith("ara-"));
if (!sampleHadithEdition) throw new Error("Fawaz Hadith catalogue: no Arabic edition found");
await request(
	"Fawaz Hadith collection",
	`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${sampleHadithEdition.name}.min.json`,
	(value) => Array.isArray(value?.hadiths),
);

await request(
	"AhmedBaset Hadith collection",
	"https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book/forties/nawawi40.json",
	(value) => Array.isArray(value?.hadiths),
);
await request(
	"Open Hadith Data CSV",
	"https://raw.githubusercontent.com/mhashim6/Open-Hadith-Data/master/Sahih_Al-Bukhari/sahih_al-bukhari_ahadith_mushakkala_mufassala.utf8.csv",
	null,
	{ method: "HEAD" },
);

const sunnahKey = process.env.SUNNAH_API_KEY?.trim();
if (sunnahKey) {
	await request(
		"sunnah.com authenticated catalogue",
		"https://api.sunnah.com/v1/collections?limit=1",
		(value) => Array.isArray(value?.data),
		{ headers: { "X-API-Key": sunnahKey } },
	);
} else {
	const response = await fetch("https://api.sunnah.com/v1/collections?limit=1", {
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (response.status !== 401 && response.status !== 403) {
		throw new Error(`sunnah.com auth gate: expected 401/403, got ${response.status}`);
	}
	console.log(`○ sunnah.com authenticated catalogue skipped (set SUNNAH_API_KEY); auth gate returned ${response.status}`);
}

if (!Object.keys(fawazQuran).length) process.exitCode = 1;

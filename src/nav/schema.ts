// Pure types for the bundled Quran boundary/navigation data (juz, hizb, rub,
// page, sajdah, ruku). No obsidian import — safe to use anywhere, including
// the dev-only generation script's consumers and tests.

export interface NavPoint {
	n: number;
	surah: number;
	ayah: number;
}

export interface Sajdah {
	surah: number;
	ayah: number;
	type: "recommended" | "obligatory";
}

export interface QuranNav {
	juz: NavPoint[]; // 30
	hizb: NavPoint[]; // 60
	rub: NavPoint[]; // 240
	pages: NavPoint[]; // 604
	sajdahs: Sajdah[]; // 15
	ruku: NavPoint[]; // ~540+ (data only, no UI in PR1)
}

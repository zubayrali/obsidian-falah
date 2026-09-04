import type { QcfPage } from "./schema";
import { parseQcfPage, QCF_PAGE_COUNT, qcfFontFile } from "./schema";

const DATA_ROOT = "https://raw.githubusercontent.com/MohamadHajjRabee/quran-qcf4/main";
const FONT_ROOT = "https://cdn.jsdelivr.net/gh/MohamadHajjRabee/quran-qcf4@main/fonts-woff2";

export interface QcfAdapter {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	readBinary(path: string): Promise<ArrayBuffer>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export type QcfRequest = (options: { url: string; throw?: boolean }) => Promise<{
	status: number;
	json: unknown;
	arrayBuffer: ArrayBuffer;
}>;

export interface QcfCacheStatus {
	pages: number;
	fonts: number;
	complete: boolean;
}

export class QcfStore {
	private pageCache = new Map<number, QcfPage>();
	private pageInflight = new Map<number, Promise<QcfPage>>();
	private fontInflight = new Map<string, Promise<ArrayBuffer>>();
	private documentFonts = new WeakMap<Document, Set<string>>();

	constructor(
		private adapter: QcfAdapter,
		private baseDir: string,
		private request: QcfRequest,
	) {}

	private path(relative: string): string {
		return this.baseDir ? `${this.baseDir}/qcf/${relative}` : `qcf/${relative}`;
	}

	private async ensureDir(relative: "pages" | "fonts"): Promise<void> {
		const root = this.path("").replace(/\/$/, "");
		if (!(await this.adapter.exists(root))) await this.adapter.mkdir(root);
		const dir = this.path(relative);
		if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
	}

	async getPage(page: number): Promise<QcfPage> {
		if (!Number.isInteger(page) || page < 1 || page > QCF_PAGE_COUNT) throw new Error(`Invalid Mushaf page: ${page}`);
		const cached = this.pageCache.get(page);
		if (cached) return cached;
		const active = this.pageInflight.get(page);
		if (active) return active;
		const load = this.loadPage(page).finally(() => this.pageInflight.delete(page));
		this.pageInflight.set(page, load);
		return load;
	}

	private async loadPage(page: number): Promise<QcfPage> {
		const padded = String(page).padStart(3, "0");
		const path = this.path(`pages/${padded}.json`);
		if (await this.adapter.exists(path)) {
			try {
				const cached = parseQcfPage(JSON.parse(await this.adapter.read(path)), page);
				this.pageCache.set(page, cached);
				return cached;
			} catch {
				// A partial/corrupt cache entry is repaired from the source below.
			}
		}
		const response = await this.request({ url: `${DATA_ROOT}/pages/${padded}.json`, throw: false });
		if (response.status < 200 || response.status >= 300) throw new Error(`QCF page ${page} download failed (HTTP ${response.status})`);
		const parsed = parseQcfPage(response.json, page);
		await this.ensureDir("pages");
		await this.adapter.write(path, JSON.stringify(parsed));
		this.pageCache.set(page, parsed);
		return parsed;
	}

	async ensurePageFonts(page: QcfPage, doc: Document): Promise<void> {
		const names = new Set<string>([page.font]);
		for (const line of page.lines) for (const word of line.words) names.add(word.font);
		await Promise.all([...names].map((name) => this.ensureFont(name, doc)));
	}

	private async ensureFont(name: string, doc: Document): Promise<void> {
		let loaded = this.documentFonts.get(doc);
		if (!loaded) {
			loaded = new Set();
			this.documentFonts.set(doc, loaded);
		}
		if (loaded.has(name)) return;
		const data = await this.getFont(name);
		const face = new FontFace(name, data);
		await face.load();
		(doc.fonts as FontFaceSet & { add(font: FontFace): void }).add(face);
		loaded.add(name);
	}

	private async getFont(name: string): Promise<ArrayBuffer> {
		const active = this.fontInflight.get(name);
		if (active) return active;
		const load = this.loadFont(name).finally(() => this.fontInflight.delete(name));
		this.fontInflight.set(name, load);
		return load;
	}

	private async loadFont(name: string): Promise<ArrayBuffer> {
		const file = qcfFontFile(name);
		const path = this.path(`fonts/${file}`);
		if (await this.adapter.exists(path)) return this.adapter.readBinary(path);
		const response = await this.request({ url: `${FONT_ROOT}/${file}`, throw: false });
		if (response.status < 200 || response.status >= 300) throw new Error(`QCF font download failed (HTTP ${response.status})`);
		await this.ensureDir("fonts");
		await this.adapter.writeBinary(path, response.arrayBuffer);
		return response.arrayBuffer;
	}

	prefetch(page: number): void {
		for (const nearby of [page - 1, page + 1]) {
			if (nearby >= 1 && nearby <= QCF_PAGE_COUNT) void this.getPage(nearby).catch(() => undefined);
		}
	}

	async cacheStatus(): Promise<QcfCacheStatus> {
		const count = async (relative: "pages" | "fonts", pattern: RegExp) => {
			const path = this.path(relative);
			if (!(await this.adapter.exists(path))) return 0;
			return (await this.adapter.list(path)).files.filter((file) => pattern.test(file)).length;
		};
		const [pages, fonts] = await Promise.all([
			count("pages", /\/\d{3}\.json$/),
			count("fonts", /\/QCF4_(?:Hafs_\d{2}_W|QBSML)\.woff2$/),
		]);
		return { pages, fonts, complete: pages >= QCF_PAGE_COUNT && fonts >= 48 };
	}

	async downloadComplete(
		onProgress: (done: number, total: number) => void,
		signal?: AbortSignal,
	): Promise<void> {
		const fonts = ["QCF4_QBSML", ...Array.from({ length: 47 }, (_, index) => `QCF4_Hafs_${String(index + 1).padStart(2, "0")}`)];
		const jobs: Array<() => Promise<unknown>> = [
			...Array.from({ length: QCF_PAGE_COUNT }, (_, index) => () => this.getPage(index + 1)),
			...fonts.map((font) => () => this.getFont(font)),
		];
		let cursor = 0;
		let done = 0;
		const worker = async () => {
			while (cursor < jobs.length) {
				if (signal?.aborted) return;
				const job = jobs[cursor++];
				await job();
				onProgress(++done, jobs.length);
			}
		};
		await Promise.all(Array.from({ length: 4 }, () => worker()));
	}
}

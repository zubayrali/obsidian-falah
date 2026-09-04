export interface Reciter {
	id: string;
	name: string;
	baseUrl: string;
	bitrateKbps: number;
}
export interface AudioRef { surah: number; ayah: number }

export interface AudioBackend {
	load(url: string): void;
	play(): Promise<void>;
	pause(): void;
	onEnded(cb: () => void): () => void;
	onError?(cb: (error: unknown) => void): () => void;
}

export type RecitationStatus = "idle" | "loading" | "playing" | "paused" | "error";
export interface RecitationError { code: "offline" | "source" | "playback"; message: string }
export interface RepeatRange { from: AudioRef; to: AudioRef }
export interface RecitationState {
	current?: AudioRef;
	playing: boolean;
	status: RecitationStatus;
	repeat?: RepeatRange;
	source?: "cache" | "network";
	error?: RecitationError;
}

export type RecitationAction =
	| { type: "play"; ref?: AudioRef }
	| { type: "pause" }
	| { type: "toggle"; ref?: AudioRef }
	| { type: "next" }
	| { type: "previous" }
	| { type: "retry" }
	| { type: "set-reciter"; reciter: Reciter }
	| { type: "set-repeat"; from: AudioRef; to: AudioRef }
	| { type: "clear-repeat" };

export interface RecitationControls {
	primary: "play" | "pause" | "retry";
	busy: boolean;
	canPlay: boolean;
	canPause: boolean;
	canGoNext: boolean;
	canGoPrevious: boolean;
	hasRepeat: boolean;
}

export function recitationControls(state: RecitationState): RecitationControls {
	return {
		primary: state.status === "error" ? "retry" : state.playing ? "pause" : "play",
		busy: state.status === "loading",
		canPlay: Boolean(state.current) && state.status !== "loading",
		canPause: state.playing || state.status === "loading",
		canGoNext: Boolean(state.current) && state.status !== "loading",
		canGoPrevious: Boolean(state.current) && state.status !== "loading",
		hasRepeat: Boolean(state.repeat),
	};
}

export const RECITERS: Reciter[] = [
	{ id: "alafasy", name: "Mishary Rashid Alafasy", baseUrl: "https://everyayah.com/data/Alafasy_128kbps", bitrateKbps: 128 },
	{ id: "husary", name: "Mahmoud Khalil Al-Husary", baseUrl: "https://everyayah.com/data/Husary_128kbps", bitrateKbps: 128 },
	{ id: "minshawi", name: "Muhammad Siddiq Al-Minshawi", baseUrl: "https://everyayah.com/data/Minshawy_Murattal_128kbps", bitrateKbps: 128 },
	{ id: "abdul-basit", name: "Abdul Basit Abdus Samad", baseUrl: "https://everyayah.com/data/Abdul_Basit_Murattal_192kbps", bitrateKbps: 192 },
	{ id: "sudais", name: "Abdul Rahman Al-Sudais", baseUrl: "https://everyayah.com/data/Abdurrahmaan_As-Sudais_192kbps", bitrateKbps: 192 },
	{ id: "shatri", name: "Abu Bakr Al-Shatri", baseUrl: "https://everyayah.com/data/Abu_Bakr_Ash-Shaatree_128kbps", bitrateKbps: 128 },
	{ id: "muaiqly", name: "Maher Al-Muaiqly", baseUrl: "https://everyayah.com/data/MaherAlMuaiqly128kbps", bitrateKbps: 128 },
	{ id: "shuraim", name: "Saud Al-Shuraim", baseUrl: "https://everyayah.com/data/Saood_ash-Shuraym_128kbps", bitrateKbps: 128 },
	{ id: "ayyub", name: "Muhammad Ayyub", baseUrl: "https://everyayah.com/data/Muhammad_Ayyoub_128kbps", bitrateKbps: 128 },
	{ id: "jibreel", name: "Muhammad Jibreel", baseUrl: "https://everyayah.com/data/Muhammad_Jibreel_128kbps", bitrateKbps: 128 },
	{ id: "rifai", name: "Hani Ar-Rifai", baseUrl: "https://everyayah.com/data/Hani_Rifai_192kbps", bitrateKbps: 192 },
	{ id: "hudhaify", name: "Ali Al-Hudhaify", baseUrl: "https://everyayah.com/data/Hudhaify_128kbps", bitrateKbps: 128 },
	{ id: "ghamdi", name: "Saad Al-Ghamdi", baseUrl: "https://everyayah.com/data/Ghamadi_40kbps", bitrateKbps: 40 },
];

export const RECITATION_CACHE_NAME = "falah-recitation-v1";

const pad = (n: number, width: number) => String(n).padStart(width, "0");
export function recitationUrl(reciter: Reciter, ref: AudioRef): string {
	return `${reciter.baseUrl}/${pad(ref.surah, 3)}${pad(ref.ayah, 3)}.mp3`;
}
export function compareRef(a: AudioRef, b: AudioRef): number { return a.surah - b.surah || a.ayah - b.ayah; }

export interface ResolvedAudioSource { url: string; source: "cache" | "network" }
/** A storage adapter may return any URL that the audio backend can play. */
export interface RecitationCache {
	match(remoteUrl: string): Promise<string | undefined>;
	store(remoteUrl: string): Promise<string>;
	dispose?(): void;
}
export interface AudioSourceResolver {
	resolve(remoteUrl: string): Promise<ResolvedAudioSource>;
	prefetch?(remoteUrl: string): Promise<void>;
	dispose?(): void;
}

export class AudioUnavailableError extends Error {
	constructor(message = "This recitation is not cached and the device is offline.") {
		super(message);
		this.name = "AudioUnavailableError";
	}
}

export class DirectAudioSourceResolver implements AudioSourceResolver {
	async resolve(remoteUrl: string): Promise<ResolvedAudioSource> { return { url: remoteUrl, source: "network" }; }
}

/** Cache-first resolution with an explicit, testable online-state dependency. */
export class CacheFirstAudioSourceResolver implements AudioSourceResolver {
	constructor(
		private cache: RecitationCache,
		private isOnline: () => boolean = () => typeof navigator === "undefined" || navigator.onLine,
		private cacheMisses = true,
	) {}

	async resolve(remoteUrl: string): Promise<ResolvedAudioSource> {
		try {
			const cached = await this.cache.match(remoteUrl);
			if (cached) return { url: cached, source: "cache" };
		} catch {
			// A broken cache must not prevent normal online playback.
		}
		if (!this.isOnline()) throw new AudioUnavailableError();
		if (this.cacheMisses) {
			try { return { url: await this.cache.store(remoteUrl), source: "cache" }; }
			catch { /* CORS, quota, or cache failures fall back to streaming. */ }
		}
		return { url: remoteUrl, source: "network" };
	}

	async prefetch(remoteUrl: string): Promise<void> {
		if (!await this.cache.match(remoteUrl)) await this.cache.store(remoteUrl);
	}
	dispose(): void { this.cache.dispose?.(); }
}

/** Browser Cache Storage implementation; cached responses are exposed as blob URLs. */
export class CacheStorageRecitationCache implements RecitationCache {
	private objectUrls = new Set<string>();
	constructor(
		private cacheName = RECITATION_CACHE_NAME,
		private cacheStorage: CacheStorage = caches,
	) {}

	async match(remoteUrl: string): Promise<string | undefined> {
		const response = await (await this.cacheStorage.open(this.cacheName)).match(remoteUrl);
		return response ? this.toObjectUrl(await response.blob()) : undefined;
	}
	async store(remoteUrl: string): Promise<string> {
		const cache = await this.cacheStorage.open(this.cacheName);
		await cache.add(remoteUrl);
		const response = await cache.match(remoteUrl);
		if (!response) throw new Error("Audio was downloaded but could not be read from the cache.");
		return this.toObjectUrl(await response.blob());
	}
	dispose(): void {
		for (const url of this.objectUrls) URL.revokeObjectURL(url);
		this.objectUrls.clear();
	}
	private toObjectUrl(blob: Blob): string {
		const url = URL.createObjectURL(blob);
		this.objectUrls.add(url);
		return url;
	}
}

/** Cache Storage is not guaranteed in every Obsidian mobile WebView. */
export function createDefaultAudioSourceResolver(): AudioSourceResolver {
	return typeof caches === "undefined"
		? new DirectAudioSourceResolver()
		: new CacheFirstAudioSourceResolver(new CacheStorageRecitationCache());
}

export class RecitationController {
	private state: RecitationState = { playing: false, status: "idle" };
	private listeners = new Set<(state: RecitationState) => void>();
	private disposeEnded: () => void;
	private disposeError?: () => void;
	private operation = 0;
	private disposed = false;

	constructor(
		private backend: AudioBackend,
		private reciter: Reciter,
		private ayahCount: (surah: number) => number,
		private sourceResolver: AudioSourceResolver = new DirectAudioSourceResolver(),
	) {
		this.disposeEnded = backend.onEnded(() => {
			void this.advance().catch((error: unknown) => {
				if (this.state.status !== "error") this.fail(error, "playback");
			});
		});
		this.disposeError = backend.onError?.((error) => this.fail(error, "playback"));
	}

	snapshot(): RecitationState {
		return {
			...this.state,
			current: this.state.current && { ...this.state.current },
			repeat: this.state.repeat && { from: { ...this.state.repeat.from }, to: { ...this.state.repeat.to } },
			error: this.state.error && { ...this.state.error },
		};
	}
	controls(): RecitationControls { return recitationControls(this.state); }
	onChange(cb: (state: RecitationState) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	async dispatch(action: RecitationAction): Promise<void> {
		switch (action.type) {
			case "play": await this.play(action.ref); break;
			case "pause": this.pause(); break;
			case "toggle": if (this.state.playing) this.pause(); else await this.play(action.ref); break;
			case "next": await this.next(); break;
			case "previous": await this.previous(); break;
			case "retry": await this.play(); break;
			case "set-reciter": await this.setReciter(action.reciter); break;
			case "set-repeat": this.setRepeat(action.from, action.to); break;
			case "clear-repeat": this.setRepeat(); break;
		}
	}

	async setReciter(reciter: Reciter): Promise<void> {
		this.reciter = reciter;
		if (!this.state.current) return;
		const wasPlaying = this.state.playing;
		this.backend.pause();
		this.state.playing = false;
		this.state.status = "paused";
		this.state.source = undefined;
		this.state.error = undefined;
		this.emit();
		if (wasPlaying) await this.play();
	}

	setRepeat(from?: AudioRef, to?: AudioRef): void {
		if (!from || !to) this.state.repeat = undefined;
		else {
			const validFrom = this.validRef(from);
			const validTo = this.validRef(to);
			this.state.repeat = compareRef(validFrom, validTo) <= 0
				? { from: validFrom, to: validTo }
				: { from: validTo, to: validFrom };
		}
		this.emit();
	}

	async play(ref?: AudioRef): Promise<void> {
		this.assertActive();
		if (ref) this.state.current = this.validRef(ref);
		if (!this.state.current) return;
		const operation = ++this.operation;
		this.state.playing = false;
		this.state.status = "loading";
		this.state.error = undefined;
		this.emit();
		let phase: RecitationError["code"] = "source";
		try {
			const source = await this.sourceResolver.resolve(recitationUrl(this.reciter, this.state.current));
			if (operation !== this.operation || this.disposed) return;
			this.backend.load(source.url);
			this.state.source = source.source;
			phase = "playback";
			await this.backend.play();
			if (operation !== this.operation || this.disposed) return;
			this.state.playing = true;
			this.state.status = "playing";
			this.emit();
		} catch (error) {
			if (operation === this.operation && !this.disposed) this.fail(error, error instanceof AudioUnavailableError ? "offline" : phase);
			throw error;
		}
	}

	pause(): void {
		if (this.disposed) return;
		this.operation++;
		this.backend.pause();
		this.state.playing = false;
		this.state.status = this.state.current ? "paused" : "idle";
		this.emit();
	}
	async next(): Promise<void> { await this.move(1); }
	async previous(): Promise<void> { await this.move(-1); }
	async prefetch(ref: AudioRef): Promise<void> {
		if (this.sourceResolver.prefetch) await this.sourceResolver.prefetch(recitationUrl(this.reciter, this.validRef(ref)));
	}

	dispose(): void {
		if (this.disposed) return;
		this.operation++;
		this.backend.pause();
		this.state.playing = false;
		this.state.status = this.state.current ? "paused" : "idle";
		this.disposeEnded();
		this.disposeError?.();
		this.sourceResolver.dispose?.();
		this.listeners.clear();
		this.disposed = true;
	}

	private async advance(): Promise<void> {
		if (!this.state.current || this.disposed) return;
		const repeat = this.state.repeat;
		if (repeat && compareRef(this.state.current, repeat.to) >= 0) {
			await this.play(repeat.from);
			return;
		}
		await this.move(1, true);
	}

	private async move(delta: 1 | -1, stopAtEnd = false): Promise<void> {
		const cur = this.state.current;
		if (!cur) return;
		let next: AudioRef;
		if (delta === 1) {
			if (cur.ayah < this.ayahCount(cur.surah)) next = { surah: cur.surah, ayah: cur.ayah + 1 };
			else if (cur.surah < 114) next = { surah: cur.surah + 1, ayah: 1 };
			else { if (stopAtEnd) this.pause(); return; }
		} else if (cur.ayah > 1) next = { surah: cur.surah, ayah: cur.ayah - 1 };
		else if (cur.surah > 1) next = { surah: cur.surah - 1, ayah: this.ayahCount(cur.surah - 1) };
		else return;
		await this.play(next);
	}

	private validRef(ref: AudioRef): AudioRef {
		if (!Number.isInteger(ref.surah) || ref.surah < 1 || ref.surah > 114) throw new RangeError("Surah must be between 1 and 114.");
		const count = this.ayahCount(ref.surah);
		if (!Number.isInteger(ref.ayah) || ref.ayah < 1 || ref.ayah > count) throw new RangeError(`Ayah must be between 1 and ${count}.`);
		return { ...ref };
	}
	private fail(error: unknown, code: RecitationError["code"]): void {
		if (this.disposed) return;
		this.state.playing = false;
		this.state.status = "error";
		this.state.error = { code, message: error instanceof Error ? error.message : String(error) };
		this.emit();
	}
	private assertActive(): void {
		if (this.disposed) throw new Error("Recitation controller has been disposed.");
	}
	private emit(): void {
		const snapshot = this.snapshot();
		for (const cb of this.listeners) cb(snapshot);
	}
}

export class HtmlAudioBackend implements AudioBackend {
	private ended = new Set<() => void>();
	private errors = new Set<(error: unknown) => void>();
	constructor(private audio = new Audio()) {
		this.audio.addEventListener("ended", () => { for (const cb of this.ended) cb(); });
		this.audio.addEventListener("error", () => {
			const error = this.audio.error ?? new Error("Audio playback failed.");
			for (const cb of this.errors) cb(error);
		});
	}
	load(url: string): void { this.audio.src = url; }
	play(): Promise<void> { return this.audio.play(); }
	pause(): void { this.audio.pause(); }
	onEnded(cb: () => void): () => void { this.ended.add(cb); return () => this.ended.delete(cb); }
	onError(cb: (error: unknown) => void): () => void { this.errors.add(cb); return () => this.errors.delete(cb); }
}

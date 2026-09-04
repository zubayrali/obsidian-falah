import { describe, expect, it, vi } from "vitest";
import {
	AudioUnavailableError,
	CacheFirstAudioSourceResolver,
	DirectAudioSourceResolver,
	RECITERS,
	RecitationController,
	recitationControls,
	recitationUrl,
	type AudioBackend,
	type AudioSourceResolver,
	type RecitationCache,
} from "./recitation";

class FakeAudio implements AudioBackend {
	url = "";
	plays = 0;
	pauses = 0;
	playError?: Error;
	ended?: () => void;
	error?: (error: unknown) => void;
	load(url: string) { this.url = url; }
	async play() { this.plays++; if (this.playError) throw this.playError; }
	pause() { this.pauses++; }
	onEnded(cb: () => void) { this.ended = cb; return () => { this.ended = undefined; }; }
	onError(cb: (error: unknown) => void) { this.error = cb; return () => { this.error = undefined; }; }
}

class FakeCache implements RecitationCache {
	stored = new Map<string, string>();
	storeError?: Error;
	async match(url: string) { return this.stored.get(url); }
	async store(url: string) {
		if (this.storeError) throw this.storeError;
		const local = `cache://${url}`;
		this.stored.set(url, local);
		return local;
	}
}

const ayahCount = (surah: number) => surah === 1 ? 7 : surah === 114 ? 6 : 286;
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

describe("recitation source resolution", () => {
	it("builds EveryAyah URLs", () => {
		expect(recitationUrl(RECITERS[0], { surah: 2, ayah: 255 })).toContain("002255.mp3");
	});

	it("uses cached audio while offline", async () => {
		const remote = recitationUrl(RECITERS[0], { surah: 1, ayah: 1 });
		const cache = new FakeCache();
		cache.stored.set(remote, "vault://001001.mp3");
		const resolver = new CacheFirstAudioSourceResolver(cache, () => false);

		await expect(resolver.resolve(remote)).resolves.toEqual({ url: "vault://001001.mp3", source: "cache" });
	});

	it("reports an actionable offline miss", async () => {
		const resolver = new CacheFirstAudioSourceResolver(new FakeCache(), () => false);
		await expect(resolver.resolve("https://example.test/001001.mp3")).rejects.toBeInstanceOf(AudioUnavailableError);
	});

	it("caches online misses and falls back to streaming when storage fails", async () => {
		const cache = new FakeCache();
		const resolver = new CacheFirstAudioSourceResolver(cache, () => true);
		await expect(resolver.resolve("remote.mp3")).resolves.toEqual({ url: "cache://remote.mp3", source: "cache" });

		cache.storeError = new Error("quota");
		await expect(resolver.resolve("another.mp3")).resolves.toEqual({ url: "another.mp3", source: "network" });
	});
});

describe("RecitationController transport", () => {
	it("advances and crosses surah boundaries", async () => {
		const audio = new FakeAudio();
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount);
		await ctl.play({ surah: 1, ayah: 7 });
		await ctl.next();
		expect(ctl.snapshot().current).toEqual({ surah: 2, ayah: 1 });
		expect(ctl.snapshot().status).toBe("playing");
	});

	it("moves backward across surahs and does not wrap at Quran boundaries", async () => {
		const audio = new FakeAudio();
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount);
		await ctl.play({ surah: 2, ayah: 1 });
		await ctl.previous();
		expect(ctl.snapshot().current).toEqual({ surah: 1, ayah: 7 });

		await ctl.play({ surah: 1, ayah: 1 });
		await ctl.previous();
		expect(ctl.snapshot().current).toEqual({ surah: 1, ayah: 1 });

		await ctl.play({ surah: 114, ayah: 6 });
		await ctl.next();
		expect(ctl.snapshot().current).toEqual({ surah: 114, ayah: 6 });
	});

	it("pauses at the final ayah when playback ends", async () => {
		const audio = new FakeAudio();
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount);
		await ctl.play({ surah: 114, ayah: 6 });
		audio.ended?.();
		await flush();
		expect(ctl.snapshot()).toMatchObject({ playing: false, status: "paused", current: { surah: 114, ayah: 6 } });
	});

	it("normalizes and loops a repeat range across surahs", async () => {
		const audio = new FakeAudio();
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount);
		ctl.setRepeat({ surah: 2, ayah: 2 }, { surah: 1, ayah: 7 });
		expect(ctl.snapshot().repeat).toEqual({ from: { surah: 1, ayah: 7 }, to: { surah: 2, ayah: 2 } });

		await ctl.play({ surah: 2, ayah: 2 });
		audio.ended?.();
		await flush();
		expect(ctl.snapshot().current).toEqual({ surah: 1, ayah: 7 });
	});

	it("moves through a repeat range before looping", async () => {
		const audio = new FakeAudio();
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount);
		ctl.setRepeat({ surah: 1, ayah: 2 }, { surah: 1, ayah: 3 });
		await ctl.play({ surah: 1, ayah: 2 });
		audio.ended?.();
		await flush();
		expect(ctl.snapshot().current).toEqual({ surah: 1, ayah: 3 });
		audio.ended?.();
		await flush();
		expect(ctl.snapshot().current).toEqual({ surah: 1, ayah: 2 });
	});

	it("rejects invalid references without changing the current ayah", async () => {
		const ctl = new RecitationController(new FakeAudio(), RECITERS[0], ayahCount);
		await ctl.play({ surah: 1, ayah: 1 });
		await expect(ctl.play({ surah: 1, ayah: 8 })).rejects.toThrow(RangeError);
		expect(ctl.snapshot().current).toEqual({ surah: 1, ayah: 1 });
	});
});

describe("RecitationController state and actions", () => {
	it("records playback failures and supports retry", async () => {
		const audio = new FakeAudio();
		audio.playError = new Error("decoder failed");
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount);
		await expect(ctl.play({ surah: 1, ayah: 1 })).rejects.toThrow("decoder failed");
		expect(ctl.snapshot()).toMatchObject({ playing: false, status: "error", error: { code: "playback" } });
		expect(ctl.controls().primary).toBe("retry");

		audio.playError = undefined;
		await ctl.dispatch({ type: "retry" });
		expect(ctl.snapshot()).toMatchObject({ playing: true, status: "playing", error: undefined });
	});

	it("distinguishes offline and source-resolution failures", async () => {
		const offline = new RecitationController(
			new FakeAudio(),
			RECITERS[0],
			ayahCount,
			{ resolve: async () => { throw new AudioUnavailableError(); } },
		);
		await expect(offline.play({ surah: 1, ayah: 1 })).rejects.toBeInstanceOf(AudioUnavailableError);
		expect(offline.snapshot().error?.code).toBe("offline");

		const source = new RecitationController(
			new FakeAudio(),
			RECITERS[0],
			ayahCount,
			{ resolve: async () => { throw new Error("resolver unavailable"); } },
		);
		await expect(source.play({ surah: 1, ayah: 1 })).rejects.toThrow("resolver unavailable");
		expect(source.snapshot().error?.code).toBe("source");
	});

	it("records backend media errors", async () => {
		const audio = new FakeAudio();
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount);
		await ctl.play({ surah: 1, ayah: 1 });
		audio.error?.(new Error("media error"));
		expect(ctl.snapshot()).toMatchObject({ playing: false, status: "error", error: { message: "media error" } });
	});

	it("does not resume after a pending load is paused", async () => {
		let release: ((value: { url: string; source: "network" }) => void) | undefined;
		const resolver: AudioSourceResolver = {
			resolve: vi.fn(() => new Promise<{ url: string; source: "network" }>((resolve) => { release = resolve; })),
		};
		const audio = new FakeAudio();
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount, resolver);
		const pending = ctl.play({ surah: 1, ayah: 1 });
		expect(ctl.snapshot().status).toBe("loading");
		ctl.pause();
		release?.({ url: "remote.mp3", source: "network" });
		await pending;
		expect(audio.plays).toBe(0);
		expect(ctl.snapshot().status).toBe("paused");
	});

	it("exposes UI-neutral actions and derived controls", async () => {
		const ctl = new RecitationController(new FakeAudio(), RECITERS[0], ayahCount, new DirectAudioSourceResolver());
		expect(recitationControls(ctl.snapshot())).toMatchObject({ primary: "play", canPlay: false, busy: false });
		await ctl.dispatch({ type: "play", ref: { surah: 1, ayah: 1 } });
		expect(ctl.controls()).toMatchObject({ primary: "pause", canPause: true });
		await ctl.dispatch({ type: "toggle" });
		expect(ctl.snapshot().status).toBe("paused");
		await ctl.dispatch({ type: "set-repeat", from: { surah: 1, ayah: 1 }, to: { surah: 1, ayah: 2 } });
		expect(ctl.controls().hasRepeat).toBe(true);
		await ctl.dispatch({ type: "clear-repeat" });
		expect(ctl.controls().hasRepeat).toBe(false);
	});

	it("disposes listeners and rejects subsequent playback", async () => {
		const audio = new FakeAudio();
		const ctl = new RecitationController(audio, RECITERS[0], ayahCount);
		await ctl.play({ surah: 1, ayah: 1 });
		ctl.dispose();
		expect(audio.ended).toBeUndefined();
		expect(audio.error).toBeUndefined();
		await expect(ctl.play()).rejects.toThrow("disposed");
	});
});

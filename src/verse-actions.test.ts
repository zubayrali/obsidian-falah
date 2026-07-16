import { describe, expect, it } from "vitest";
import { defaultVerseActions, tafsirMenuItems } from "./verse-actions";
import type { VerseContext, VerseView } from "./verse-actions";
import type { ResourceDescriptor } from "./data/schema";

function tafsir(id: string, name: string): ResourceDescriptor {
	return { id, type: "tafsir", name, language: "en", tier: "downloaded" };
}
function translation(id: string, name: string): ResourceDescriptor {
	return { id, type: "translation", name, language: "en", tier: "downloaded" };
}

function makeCtx(opts: {
	translation?: string;
	shown?: Set<string>;
	toggles?: string[];
	listResources?: ResourceDescriptor[];
	openCapture?: { ref?: unknown };
} = {}): VerseContext {
	const shown = opts.shown ?? new Set<string>();
	const view: VerseView = {
		isVerseTafsirShown: (_k, id) => shown.has(id),
		toggleVerseTafsir: (_k, id) => void (opts.toggles ?? []).push(id),
	};
	const plugin = {
		quranData: { listResources: async () => opts.listResources ?? [] },
		openDetail: (ref: unknown) => {
			if (opts.openCapture) opts.openCapture.ref = ref;
		},
	} as unknown as VerseContext["plugin"];
	return {
		surah: 2,
		ayah: 255,
		ayahKey: "2:255",
		arabic: "arabic text",
		translation: opts.translation,
		plugin,
		view,
	};
}

describe("tafsirMenuItems", () => {
	it("builds one checked/unchecked toggle item per installed tafsir", () => {
		const ctx = makeCtx({ shown: new Set(["t1"]) });
		const items = tafsirMenuItems([tafsir("t1", "Ibn Kathir"), tafsir("t2", "Tabari")], ctx);
		expect(items.map((i) => [i.title, i.checked])).toEqual([
			["Ibn Kathir", true],
			["Tabari", false],
		]);
	});
	it("onClick toggles that tafsir on this verse", () => {
		const toggles: string[] = [];
		const ctx = makeCtx({ toggles });
		const items = tafsirMenuItems([tafsir("t2", "Tabari")], ctx);
		void items[0].onClick!();
		expect(toggles).toEqual(["t2"]);
	});
});

describe("defaultVerseActions", () => {
	const actions = defaultVerseActions();
	const byId = (id: string) => actions.find((a) => a.id === id)!;

	it("tafsir action nests only tafsir resources under a 'Tafsir' submenu", async () => {
		const ctx = makeCtx({ listResources: [translation("x", "Sahih"), tafsir("t1", "Ibn Kathir")] });
		const items = await byId("tafsir").items(ctx);
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe("Tafsir");
		expect(items[0].submenu?.map((i) => i.title)).toEqual(["Ibn Kathir"]);
	});

	it("tafsir action contributes nothing when no tafsirs are installed", async () => {
		const ctx = makeCtx({ listResources: [translation("x", "Sahih")] });
		expect(await byId("tafsir").items(ctx)).toEqual([]);
	});
	it("copy action offers Arabic-only without a translation, and three with one", async () => {
		expect((await byId("copy").items(makeCtx())).map((i) => i.title)).toEqual(["Copy Arabic"]);
		expect((await byId("copy").items(makeCtx({ translation: "t" }))).map((i) => i.title)).toEqual([
			"Copy Arabic",
			"Copy translation",
			"Copy verse (Arabic + translation)",
		]);
	});
	it("open-detail action opens the verse's detail view", async () => {
		const openCapture: { ref?: unknown } = {};
		const items = await byId("open-detail").items(makeCtx({ openCapture }));
		void items[0].onClick!();
		expect(openCapture.ref).toEqual({ kind: "quran", surah: 2, ayah: 255 });
	});
});

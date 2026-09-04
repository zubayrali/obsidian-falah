import { describe, expect, it } from "vitest";
import { FALAH_API_VERSION, ReferenceActionRegistry, SlashItemRegistry, VerseActionRegistry } from "./api";
import type { ReferenceAction, SlashItem } from "./api";
import type { VerseAction } from "./verse-actions";
import FalahPlugin from "./main";

const a = (id: string): VerseAction => ({ id, items: () => [] });

describe("VerseActionRegistry", () => {
	it("lists defaults, adds registered, and unregisters", () => {
		const reg = new VerseActionRegistry([a("tafsir")]);
		expect(reg.list().map((x) => x.id)).toEqual(["tafsir"]);
		const off = reg.register(a("reflect"));
		expect(reg.list().map((x) => x.id)).toEqual(["tafsir", "reflect"]);
		off();
		expect(reg.list().map((x) => x.id)).toEqual(["tafsir"]);
	});
});

describe("ayah-row decorator registry", () => {
	it("registers and unregisters a decorator", () => {
		const plugin = Object.create(FalahPlugin.prototype) as FalahPlugin;
		(plugin as unknown as { ayahRowDecorators: unknown[] }).ayahRowDecorators = [];
		const dec = () => {};
		const off = plugin.registerAyahRowDecorator(dec);
		expect(plugin.ayahRowDecorators).toContain(dec);
		off();
		expect(plugin.ayahRowDecorators).not.toContain(dec);
	});
});

describe("SlashItemRegistry", () => {
	const item = (id: string): SlashItem => ({ id, label: id, keywords: "", onSelect: () => {} });

	it("starts empty, adds registered items in order, and unregisters", () => {
		const reg = new SlashItemRegistry();
		expect(reg.list()).toEqual([]);

		const offA = reg.register(item("reflect"));
		const offB = reg.register(item("other"));
		expect(reg.list().map((x) => x.id)).toEqual(["reflect", "other"]);

		offA();
		expect(reg.list().map((x) => x.id)).toEqual(["other"]);
		offB();
		expect(reg.list()).toEqual([]);
	});

	it("unregistering twice is harmless", () => {
		const reg = new SlashItemRegistry();
		const off = reg.register(item("reflect"));
		off();
		off();
		expect(reg.list()).toEqual([]);
	});

	it("list() returns a copy — mutating it does not affect the registry", () => {
		const reg = new SlashItemRegistry();
		reg.register(item("reflect"));
		reg.list().push(item("injected"));
		expect(reg.list().map((x) => x.id)).toEqual(["reflect"]);
	});
});

describe("ReferenceActionRegistry", () => {
	const action = (id: string): ReferenceAction => ({ id, items: () => [] });

	it("adds actions in order and unregisters idempotently", () => {
		const reg = new ReferenceActionRegistry();
		const offA = reg.register(action("reflect"));
		const offB = reg.register(action("share"));
		expect(reg.list().map((x) => x.id)).toEqual(["reflect", "share"]);

		offA();
		offA();
		expect(reg.list().map((x) => x.id)).toEqual(["share"]);
		offB();
		expect(reg.list()).toEqual([]);
	});

	it("returns a copy of the registered actions", () => {
		const reg = new ReferenceActionRegistry();
		reg.register(action("reflect"));
		reg.list().push(action("injected"));
		expect(reg.list().map((x) => x.id)).toEqual(["reflect"]);
	});
});

describe("api v7 reference-action surface", () => {
	it("version is 7", () => {
		expect(FALAH_API_VERSION).toBe(7);
	});
});

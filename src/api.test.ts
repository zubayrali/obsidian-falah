import { describe, expect, it } from "vitest";
import { VerseActionRegistry } from "./api";
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

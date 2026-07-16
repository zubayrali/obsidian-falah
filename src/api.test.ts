import { describe, expect, it } from "vitest";
import { VerseActionRegistry } from "./api";
import type { VerseAction } from "./verse-actions";

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

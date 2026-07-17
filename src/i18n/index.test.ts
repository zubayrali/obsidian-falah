import { describe, expect, it } from "vitest";
import { buildStrings, resolveBundle } from "./index";
import { en } from "./en";
import { ar } from "./ar";

describe("resolveBundle", () => {
	const ar = { pluginName: "فلاح" };
	const pt = { pluginName: "Falah PT" };
	const bundles = { ar, pt };
	it("matches an exact locale, case-insensitively", () => {
		expect(resolveBundle("ar", bundles)).toBe(ar);
		expect(resolveBundle("AR", bundles)).toBe(ar);
	});
	it("falls back from a regional variant to its base language", () => {
		// pt-BR has no bundle of its own; pt does.
		expect(resolveBundle("pt-BR", bundles)).toBe(pt);
		expect(resolveBundle("pt_BR", bundles)).toBe(pt);
	});
	it("returns an empty bundle for an unknown locale", () => {
		expect(resolveBundle("xx", bundles)).toEqual({});
	});
});

describe("buildStrings", () => {
	it("is English when no bundle matches", () => {
		expect(buildStrings("xx", {})).toEqual(en);
	});
	it("overlays a partial bundle and keeps untranslated keys in English", () => {
		const s = buildStrings("ar", { ar: { pluginName: "فلاح" } });
		expect(s.pluginName).toBe("فلاح");
		// every other key still resolves, in English — no blanks, no key names
		for (const k of Object.keys(en) as (keyof typeof en)[]) {
			if (k !== "pluginName") expect(s[k]).toBe(en[k]);
		}
	});
});

describe("real ar bundle", () => {
	it("an Arabic reader gets Arabic where we have it and English everywhere else", () => {
		const s = buildStrings("ar");
		expect(s.pluginName).toBe(ar.pluginName);
		const untranslated = (Object.keys(en) as (keyof typeof en)[]).filter((k) => !(k in ar));
		expect(untranslated.length).toBeGreaterThan(0); // the point: a partial bundle
		for (const k of untranslated) expect(s[k]).toBe(en[k]);
	});
});

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { filterSettingsSections } from "./search";

function fixture() {
	const container = document.createElement("div");
	const section = document.createElement("section");
	section.className = "falah-settings-section";
	const summary = document.createElement("header");
	summary.className = "falah-settings-section-header";
	summary.textContent = "Reading defaults";
	section.append(summary);
	const rows = ["Preferred translation", "Preferred tafsir", "Arabic script"].map((text) => {
		const row = document.createElement("div");
		row.className = "setting-item";
		row.textContent = text;
		section.append(row);
		return row;
	});
	container.append(section);
	return { container, section, rows };
}

describe("Settings search", () => {
	it("finds controls by all words and restores every row on clearing", () => {
		const { container, section, rows } = fixture();
		filterSettingsSections(container, "translation preferred");
		expect(rows.map((row) => row.hidden)).toEqual([false, true, true]);
		expect(section.hidden).toBe(false);
		filterSettingsSections(container, "");
		expect(rows.every((row) => !row.hidden)).toBe(true);
	});
	it("shows the whole section when its heading matches", () => {
		const { container, section, rows } = fixture();
		filterSettingsSections(container, "defaults");
		expect(section.hidden).toBe(false);
		expect(rows.every((row) => !row.hidden)).toBe(true);
	});
	it("restores unmatched sections on clearing", () => {
		const { container, section } = fixture();
		filterSettingsSections(container, "missing");
		expect(section.hidden).toBe(true);
		filterSettingsSections(container, "");
		expect(section.hidden).toBe(false);
	});
});

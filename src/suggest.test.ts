// Regression test for QuranSearchModal's report-exactly-once contract, driven
// through Obsidian's REAL call ordering (selectSuggestion -> close() ->
// onChooseSuggestion, with onClose firing synchronously from close() on
// desktop — see test/obsidian-stub.ts). Recording the pick in
// onChooseSuggestion is too late for onClose to see it under this ordering;
// that bug shipped once already and silently broke /reflect, /quran, and
// insert-quran on desktop.
import { describe, expect, it } from "vitest";
import { QuranSearchModal } from "./suggest";
import type { QuranRef } from "./ref";

const ref: QuranRef = { kind: "quran", surah: 2, ayah: 255 };
// Tests run under Vitest's default "node" environment (no jsdom/happy-dom in
// this repo, per vitest.config.ts), so there is no real MouseEvent
// constructor available. selectSuggestion only forwards evt opaquely (it
// never inspects it), so a bare object stands in fine.
const evt = {} as MouseEvent;

function modal(onResult: (r: QuranRef | undefined) => void): QuranSearchModal {
	const m = Object.create(QuranSearchModal.prototype) as QuranSearchModal;
	(m as unknown as { onResult: typeof onResult }).onResult = onResult;
	(m as unknown as { settled: boolean }).settled = false;
	(m as unknown as { picked: QuranRef | undefined }).picked = undefined;
	return m;
}

describe("QuranSearchModal", () => {
	it("reports the ref the user chose (Obsidian closes BEFORE onChooseSuggestion)", () => {
		let got: QuranRef | undefined | "NOT CALLED" = "NOT CALLED";
		const m = modal((r) => (got = r));
		m.selectSuggestion({ ref, snippet: "" }, evt);
		expect(got).toEqual(ref);
	});

	it("reports undefined when dismissed without choosing, so an awaiting caller cannot hang", () => {
		let got: QuranRef | undefined | "NOT CALLED" = "NOT CALLED";
		const m = modal((r) => (got = r));
		m.close();
		expect(got).toBeUndefined();
	});

	it("reports exactly once when a choice is followed by a close", () => {
		let calls = 0;
		const m = modal(() => calls++);
		m.selectSuggestion({ ref, snippet: "" }, evt);
		m.close();
		expect(calls).toBe(1);
	});
});

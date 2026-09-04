import { describe, expect, it } from "vitest";
import { arabicWordForDisplay, morphologyTransliterationForDisplay } from "./display";

describe("arabicWordForDisplay", () => {
	it("hides the rounded-zero annotation without changing the source value", () => {
		const source = "خُلِّفُوا۟";
		expect(arabicWordForDisplay(source)).toBe("خُلِّفُوا");
		expect(source).toBe("خُلِّفُوا۟");
	});

	it("preserves other Quranic marks", () => {
		expect(arabicWordForDisplay("لِيَتُوبُوٓا۟ ۚ")).toBe("لِيَتُوبُوٓا ۚ");
	});

	it("hides legacy corpus annotation tokens from imported morphology", () => {
		expect(arabicWordForDisplay("وا@")).toBe("وا");
		expect(morphologyTransliterationForDisplay("wā@")).toBe("wā");
	});
});

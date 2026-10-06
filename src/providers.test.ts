import { describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("obsidian", () => ({ requestUrl: request }));
import { HadithCdnProvider } from "./providers";

describe("HadithCdnProvider", () => {
	it("never strips a letter suffix and fetches an unrelated numeric record", async () => {
		request.mockClear();
		await expect(new HadithCdnProvider().getHadith({ kind: "hadith", collection: "muslim", number: "8a" })).rejects.toThrow("letter-suffixed");
		expect(request).not.toHaveBeenCalled();
	});
	it("reports empty upstream records as missing instead of returning a blank hadith", async () => {
		request.mockResolvedValue({ status: 200, json: { hadiths: [{ text: "" }] } });
		await expect(new HadithCdnProvider().getHadith({ kind: "hadith", collection: "muslim", number: "1" })).rejects.toThrow("not found");
	});
	it("returns the available language when the other edition contains an empty placeholder", async () => {
		request.mockImplementation(async ({ url }: { url: string }) => ({
			status: 200, json: { hadiths: [{ text: url.includes("ara-") ? "نص الحديث" : "" }] },
		}));
		const content = await new HadithCdnProvider().getHadith({ kind: "hadith", collection: "muslim", number: "3" });
		expect(content.arabic).toBe("نص الحديث");
		expect(content.translation).toBeUndefined();
	});
});

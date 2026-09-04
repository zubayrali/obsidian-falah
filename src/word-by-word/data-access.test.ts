import { describe, expect, it, vi } from "vitest";
import type { ResourceDescriptor } from "../data/schema";
import { lookupWordByWordVerse, type WordByWordDataAccess, type WordByWordResource } from "./data-access";

function resource(installed: boolean): WordByWordResource {
	return {
		descriptor: {
			id: "words-en",
			type: "translation",
			name: "English words",
			language: "en",
			tier: "downloaded",
			cardinality: "per-word",
		} satisfies ResourceDescriptor,
		installed,
	};
}

function access(
	resources: WordByWordResource[],
	verse: Awaited<ReturnType<WordByWordDataAccess["readVerse"]>> | null = {
		ayahKey: "1:1",
		words: [{ position: 1, text: "بسم" }],
	},
): WordByWordDataAccess {
	return {
		listResources: vi.fn().mockResolvedValue(resources),
		installResource: vi.fn().mockResolvedValue(undefined),
		readVerse: vi.fn().mockResolvedValue(verse ?? undefined),
	};
}

describe("word-by-word data access", () => {
	it("distinguishes an installable resource from absent verse data", async () => {
		const missingResource = await lookupWordByWordVerse(access([resource(false)]), "words-en", "1:1");
		expect(missingResource.state).toBe("resource-not-installed");

		const installedAccess = access([resource(true)], null);
		const missingVerse = await lookupWordByWordVerse(installedAccess, "words-en", "1:2");
		expect(missingVerse.state).toBe("verse-not-found");
	});

	it("returns ready data for an installed resource", async () => {
		const result = await lookupWordByWordVerse(access([resource(true)]), "words-en", "1:1");
		expect(result.state).toBe("ready");
	});
});

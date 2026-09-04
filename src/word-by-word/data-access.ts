import type { AyahKey, ResourceDescriptor } from "../data/schema";
import type { WordByWordVerse } from "./model";

export interface WordByWordResource {
	descriptor: ResourceDescriptor;
	installed: boolean;
}

export type WordByWordLookup =
	| { state: "ready"; resource: WordByWordResource; verse: WordByWordVerse }
	| { state: "resource-not-installed"; resource: WordByWordResource }
	| { state: "resource-not-found"; resourceId: string }
	| { state: "verse-not-found"; resource: WordByWordResource; ayahKey: AyahKey };

/**
 * Boundary implemented by the data layer. Installation remains explicit so a
 * renderer never starts a network request merely because a verse was opened.
 */
export interface WordByWordDataAccess {
	listResources(): Promise<readonly WordByWordResource[]>;
	installResource(resourceId: string): Promise<void>;
	readVerse(resourceId: string, ayahKey: AyahKey): Promise<WordByWordVerse | undefined>;
}

export async function lookupWordByWordVerse(
	dataAccess: WordByWordDataAccess,
	resourceId: string,
	ayahKey: AyahKey,
): Promise<WordByWordLookup> {
	const resources = await dataAccess.listResources();
	const resource = resources.find((candidate) => candidate.descriptor.id === resourceId);
	if (!resource) return { state: "resource-not-found", resourceId };
	if (!resource.installed) return { state: "resource-not-installed", resource };

	const verse = await dataAccess.readVerse(resourceId, ayahKey);
	return verse
		? { state: "ready", resource, verse }
		: { state: "verse-not-found", resource, ayahKey };
}

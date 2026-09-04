import type { BookmarkStoreService } from "../bookmarks/store";
import type { AyahRowDecorator, FalahApi, ReferenceAction, SlashItem, VerseText } from "../api";
import { FALAH_API_VERSION, FALAH_REF } from "../api";
import type { QuranRef } from "../ref";
import type { VerseAction } from "../verse-actions";

export interface PluginApiHost {
	bookmarks: BookmarkStoreService;
	registerVerseAction(action: VerseAction): () => void;
	registerReferenceAction(action: ReferenceAction): () => void;
	registerAyahRowDecorator(decorator: AyahRowDecorator): () => void;
	registerSlashItem(item: SlashItem): () => void;
	pickVerse(): Promise<QuranRef | undefined>;
	getVerseText(surah: number, ayah: number): Promise<VerseText | undefined>;
	navigateReaderTo(surah: number, ayah: number): void;
	refreshReaderRows(): void;
}

/** Build the stable companion interface without exposing plugin lifecycle setup. */
export function createPluginApi(host: PluginApiHost): FalahApi {
	return {
		version: FALAH_API_VERSION,
		registerVerseAction: (action) => host.registerVerseAction(action),
		registerReferenceAction: (action) => host.registerReferenceAction(action),
		registerAyahRowDecorator: (decorator) => host.registerAyahRowDecorator(decorator),
		registerSlashItem: (item) => host.registerSlashItem(item),
		pickVerse: () => host.pickVerse(),
		getVerseText: (surah, ayah) => host.getVerseText(surah, ayah),
		navigateReaderTo: (surah, ayah) => host.navigateReaderTo(surah, ayah),
		refreshReader: () => host.refreshReaderRows(),
		ref: FALAH_REF,
		bookmarks: {
			list: () => host.bookmarks.list(),
			has: (anchor, lens) => host.bookmarks.has(anchor, lens),
			add: (input) => host.bookmarks.add(input),
			remove: (id) => host.bookmarks.remove(id),
			setFavourite: (anchor, on, lens) => host.bookmarks.setFavourite(anchor, on, lens),
			favourites: () => host.bookmarks.favourites(),
			createCollection: (name) => host.bookmarks.createGroup(name),
			moveItem: (id, toGroupId) => host.bookmarks.moveItem(id, toGroupId),
		},
		onBookmarksChanged: (callback) => host.bookmarks.onChange(callback),
	};
}

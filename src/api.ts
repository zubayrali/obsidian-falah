// Falah's public extension API. Consumed by companion plugins (obsidian-tadabbur)
// via app.plugins.plugins["falah"].api. This surface is FROZEN — breaking it
// requires bumping FALAH_API_VERSION and the consumers' minimum.
import type { App, Editor, TFile } from "obsidian";
import type { VerseAction, VerseContext } from "./verse-actions";
import type { IslamicReference, QuranRef, RenderedText, FoundReference } from "./ref";
import { toUri, toCallout, parseRefUri, findReferences, parseAyahKey } from "./ref";

export const FALAH_API_VERSION = 4;

/** True when `id` is in the user's enabled-plugin set. Unlike reading
 *  `app.plugins.plugins[id]`, this is load-order independent: `enabledPlugins`
 *  comes from config and is populated before any plugin's onload runs. Use it to
 *  answer "is this installed?", not "is its API ready?". */
export function isPluginEnabled(app: App, id: string): boolean {
	const plugins = (app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
	return plugins?.enabledPlugins?.has(id) ?? false;
}

/** Workspace event fired with the FalahApi whenever a Falah instance finishes loading.
 *  Companions must (re)register their API-scoped hooks on every emission — a
 *  disable/re-enable of Falah produces a NEW api object with empty registries. */
export const FALAH_API_READY_EVENT = "falah:api-ready";

export type AyahRowDecorator = (row: HTMLElement, ctx: VerseContext) => void;
export interface VerseText { arabic: string; translation?: string }

/** An entry a companion plugin contributes to Falah's slash menu. */
export interface SlashItem {
	id: string;
	label: string;
	/** Space-separated search terms, matched against the typed query alongside `label`. */
	keywords: string;
	/** Invoked AFTER Falah has already removed the trigger text (e.g. "/reflect")
	 *  from the editor, so the handler starts from a clean cursor.
	 *
	 *  `file` is typed nullable on purpose. Obsidian declares
	 *  EditorSuggestContext.file as a non-null TFile, but that typing is optimistic
	 *  and a handler that assumes it would crash rather than degrade. Handlers
	 *  guard and skip file-scoped work instead. */
	onSelect(editor: Editor, file: TFile | null): void | Promise<void>;
}

export interface FalahRefApi {
	toUri(ref: IslamicReference): string;
	toCallout(ref: IslamicReference, text?: RenderedText): string;
	parseRefUri(uri: string): IslamicReference | null;
	findReferences(text: string): FoundReference[];
	parseAyahKey(key: string): { surah: number; ayah: number } | null;
}

export interface FalahApi {
	readonly version: number;
	registerVerseAction(action: VerseAction): () => void;
	registerAyahRowDecorator(decorator: AyahRowDecorator): () => void;
	/** Contribute an entry to Falah's slash menu. Added in v4. Falah owns the "/"
	 *  trigger — a companion registering its own EditorSuggest on "/" would race
	 *  this one in onTrigger. */
	registerSlashItem(item: SlashItem): () => void;
	/** Ask the user to choose a verse using Falah's own search modal. Resolves
	 *  undefined if dismissed without a choice. Added in v4. */
	pickVerse(): Promise<QuranRef | undefined>;
	getVerseText(surah: number, ayah: number): Promise<VerseText | undefined>;
	navigateReaderTo(surah: number, ayah: number): void;
	/** Re-render the open Quran reader's ayah rows (re-runs row decorators). No-op if
	 *  no reader is open. Added in v2 so companion plugins can refresh their row
	 *  decorations live after their own data changes (e.g. a reflection is saved). */
	refreshReader(): void;
	ref: FalahRefApi;
}

/** Ordered registry: immutable defaults first, then dynamically registered items. */
export class VerseActionRegistry {
	private extra: VerseAction[] = [];
	constructor(private defaults: VerseAction[]) {}
	register(action: VerseAction): () => void {
		this.extra.push(action);
		return () => {
			const i = this.extra.indexOf(action);
			if (i >= 0) this.extra.splice(i, 1);
		};
	}
	list(): VerseAction[] {
		return [...this.defaults, ...this.extra];
	}
}

/** Registry for companion-contributed slash entries. No defaults: Falah's own
 *  slash entries have a different shape and live in suggest.ts. */
export class SlashItemRegistry {
	private items: SlashItem[] = [];
	register(item: SlashItem): () => void {
		this.items.push(item);
		return () => {
			const i = this.items.indexOf(item);
			if (i >= 0) this.items.splice(i, 1);
		};
	}
	list(): SlashItem[] {
		return [...this.items];
	}
}

export const FALAH_REF: FalahRefApi = { toUri, toCallout, parseRefUri, findReferences, parseAyahKey };

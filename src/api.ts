// Falah's public extension API. Consumed by companion plugins (obsidian-tadabbur)
// via app.plugins.plugins["falah"].api. This surface is FROZEN — breaking it
// requires bumping FALAH_API_VERSION and the consumers' minimum.
import type { VerseAction, VerseContext } from "./verse-actions";
import type { IslamicReference, RenderedText, FoundReference } from "./ref";
import { toUri, toCallout, parseRefUri, findReferences, parseAyahKey } from "./ref";

export const FALAH_API_VERSION = 1;

export type AyahRowDecorator = (row: HTMLElement, ctx: VerseContext) => void;
export interface VerseText { arabic: string; translation?: string }

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
	getVerseText(surah: number, ayah: number): Promise<VerseText | undefined>;
	navigateReaderTo(surah: number, ayah: number): void;
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

export const FALAH_REF: FalahRefApi = { toUri, toCallout, parseRefUri, findReferences, parseAyahKey };

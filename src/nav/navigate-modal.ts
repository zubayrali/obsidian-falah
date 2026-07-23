// "Jump to…" command palette: fuzzy-navigates to a surah, ayah, juz, hizb,
// rub, page, or sajdah using the pure resolver in ./resolve. Mirrors
// QuranSearchModal (src/suggest.ts) for rendering conventions.
import { SuggestModal } from "obsidian";
import type FalahPlugin from "../main";
import { t } from "../i18n";
import { resolveNav, type NavCandidate } from "./resolve";
import type { Surah } from "../data/schema";
import type { QuranNav } from "./schema";

export class NavigateModal extends SuggestModal<NavCandidate> {
	private surahs: Surah[] = [];
	private nav?: QuranNav;

	constructor(private plugin: FalahPlugin) {
		super(plugin.app);
		this.setPlaceholder(t().navJumpPlaceholder);
		void Promise.all([plugin.registry.core.getSurahs(), plugin.registry.core.getNav()]).then(
			([s, n]) => {
				this.surahs = s;
				this.nav = n;
			}
		);
	}

	getSuggestions(query: string): NavCandidate[] {
		if (!this.nav) return [];
		return resolveNav(query, this.surahs, this.nav);
	}

	renderSuggestion(c: NavCandidate, el: HTMLElement): void {
		el.createDiv({ cls: "falah-suggest-title", text: c.label });
		if (c.sublabel) el.createDiv({ cls: "falah-suggest-snippet", text: c.sublabel });
	}

	onChooseSuggestion(c: NavCandidate): void {
		this.plugin.navigateReaderTo(c.surah, c.ayah);
	}
}

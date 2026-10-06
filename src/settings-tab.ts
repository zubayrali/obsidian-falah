import { PluginSettingTab, setIcon } from "obsidian";
import type FalahPlugin from "./main";
import type { ResourceDescriptor } from "./data/schema";
import { errMsg } from "./providers";
import { logMessage } from "./log";
import { t } from "./i18n";
import { isPluginEnabled } from "./api";
import { renderDisplayZone, renderReaderZone } from "./settings/reader-zone";
import { LibraryZone } from "./settings/library-zone";
import { renderAdvancedZone } from "./settings/advanced-zone";
import { createSettingsSection } from "./settings/ui";
import { filterSettingsSections } from "./settings/search";

/** The Tadabbur companion — reflection/journaling built on Falah's public API. */
const TADABBUR_PLUGIN_ID = "falah-tadabbur";
const TADABBUR_URL = "https://github.com/zubayrali/obsidian-tadabbur";

type SettingsTabId = "reader" | "library" | "advanced";

export class FalahSettingTab extends PluginSettingTab {
	private activeTab: SettingsTabId = "reader";
	private readonly libraryZone: LibraryZone;
	private renderEpoch = 0;
	private filterQuery = "";

	constructor(private plugin: FalahPlugin) {
		super(plugin.app, plugin);
		this.libraryZone = new LibraryZone(plugin, () => this.render());
	}

	display(): void {
		void this.render();
	}

	openLibrary(): void {
		const setting = (this.app as unknown as {
			setting?: { open(): void; openTabById(id: string): void };
		}).setting;
		setting?.open();
		setting?.openTabById(this.plugin.manifest.id);
		// Opening the settings modal can call hide(), which resets the tab to
		// Reader. Select Library only after Obsidian has activated our plugin tab.
		this.activeTab = "library";
		void this.render();
	}

	/** Reopening Settings starts on Reader; zone-triggered re-renders retain the
	 * current tab because Obsidian does not call hide() for those. */
		hide(): void {
		this.renderEpoch += 1;
		this.activeTab = "reader";
	}

	private async render(): Promise<void> {
		const epoch = ++this.renderEpoch;
		const { containerEl } = this;
		const previousScrollTop = containerEl.scrollTop;
		containerEl.empty();

		let resources: ResourceDescriptor[];
		try {
			resources = await this.plugin.quranData.listResources();
		} catch (error) {
			if (epoch !== this.renderEpoch) return;
			logMessage(errMsg(error), "error");
			containerEl.createEl("p", {
				text: t().libraryLoadResourcesError(errMsg(error)),
				cls: "falah-settings-error",
			});
			return;
		}
		if (epoch !== this.renderEpoch) return;

		const shell = containerEl.createDiv({ cls: "falah-settings-shell" });
		const topbar = shell.createDiv({ cls: "falah-settings-topbar" });
		const nav = topbar.createDiv({
			cls: "falah-settings-nav",
			attr: { role: "tablist", "aria-label": t().pluginName },
		});
		const search = topbar.createEl("input", {
			type: "search",
			cls: "falah-settings-search",
			attr: { "aria-label": t().setSearchPlaceholder },
		});
		search.placeholder = t().setSearchPlaceholder;
		search.value = this.filterQuery;
		search.hidden = this.activeTab === "library";
		const contentId = `falah-settings-panel-${this.activeTab}`;
		const content = shell.createDiv({
			cls: "falah-settings-content",
			attr: { id: contentId, role: "tabpanel", tabindex: "0" },
		});

		const tabs: { id: SettingsTabId; label: string; icon: string }[] = [
			{ id: "reader", label: t().setTabReader, icon: "book-open-text" },
			{ id: "library", label: t().setTabLibrary, icon: "library" },
			{ id: "advanced", label: t().setTabAdvanced, icon: "sliders-horizontal" },
		];
		for (const [tabIndex, tab] of tabs.entries()) {
			const selected = tab.id === this.activeTab;
			const item = nav.createEl("button", {
				cls: `falah-settings-nav-item${selected ? " is-active" : ""}`,
				attr: {
					role: "tab",
					id: `falah-settings-tab-${tab.id}`,
					"aria-selected": String(selected),
					"aria-controls": contentId,
					tabindex: selected ? "0" : "-1",
				},
			});
			item.type = "button";
			setIcon(item, tab.icon);
			item.createSpan({ text: tab.label });
			item.onclick = () => {
				this.activeTab = tab.id;
				this.filterQuery = "";
				containerEl.scrollTop = 0;
				void this.render();
			};
			item.onkeydown = (event) => {
				const key = event.key;
				if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
				event.preventDefault();
				const rtl = getComputedStyle(nav).direction === "rtl";
				const delta = key === "ArrowRight" ? (rtl ? -1 : 1) : (rtl ? 1 : -1);
				const nextIndex = key === "Home"
					? 0
					: key === "End"
						? tabs.length - 1
						: (tabIndex + delta + tabs.length) % tabs.length;
				this.activeTab = tabs[nextIndex].id;
				this.filterQuery = "";
				containerEl.scrollTop = 0;
				void this.render().then(() => {
					containerEl.querySelector<HTMLButtonElement>('.falah-settings-nav-item[aria-selected="true"]')?.focus();
				});
			};
		}
		content.setAttr("aria-labelledby", `falah-settings-tab-${this.activeTab}`);

		if (this.activeTab === "reader") {
			renderDisplayZone(this.plugin, content, resources, () => this.render());
			renderReaderZone(this.plugin, content, () => this.render());
		} else if (this.activeTab === "library") {
			this.libraryZone.render(content, resources);
		} else {
			renderAdvancedZone(this.plugin, content);
			this.renderCompanionZone(content);
		}

		const applyFilter = () => {
			const query = this.filterQuery.trim().toLocaleLowerCase();
			filterSettingsSections(content, query);
			content.querySelector<HTMLElement>(".falah-settings-page-intro")?.toggle(!query);
			content.querySelector<HTMLElement>(".falah-settings-empty-search")?.remove();
			if (query && !content.querySelector(".falah-settings-section:not([hidden])")) {
				content.createDiv({ cls: "falah-settings-empty-search", text: t().setSearchEmpty });
			}
		};
		search.addEventListener("input", () => {
			this.filterQuery = search.value;
			applyFilter();
		});
		applyFilter();
		window.requestAnimationFrame(() => { containerEl.scrollTop = previousScrollTop; });
	}

	private renderCompanionZone(containerEl: HTMLElement): void {
		if (isPluginEnabled(this.app, TADABBUR_PLUGIN_ID)) return;

		const section = createSettingsSection(containerEl, { id: "advanced-companion", title: t().setHeadingCompanion, description: t().libraryCompanionDesc, icon: "notebook-pen" });
		const box = section.createDiv({ cls: "falah-companion" });
		box.createDiv({ cls: "falah-companion-title", text: t().libraryCompanionTitle });
		box.createDiv({ cls: "falah-companion-desc", text: t().libraryCompanionDesc });
		const link = box.createEl("a", {
			cls: "falah-companion-link",
			text: t().libraryGetTadabbur,
			href: TADABBUR_URL,
		});
		link.setAttr("target", "_blank");
		link.setAttr("rel", "noopener");
	}
}

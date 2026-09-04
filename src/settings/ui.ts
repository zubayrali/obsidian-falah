import { setIcon } from "obsidian";

export interface SettingsSectionOptions {
	id: string;
	title: string;
	description: string;
	icon: string;
	open?: boolean;
}

const openSections = new Map<string, boolean>();

const SEARCH_ACTIVE_ATTRIBUTE = "data-falah-search-active";
const SEARCH_PREVIOUS_OPEN_ATTRIBUTE = "data-falah-search-previous-open";

export function createSettingsPageIntro(
	containerEl: HTMLElement,
	title: string,
	description: string,
): void {
	const intro = containerEl.createDiv({ cls: "falah-settings-page-intro" });
	intro.createEl("h2", { text: title });
	intro.createEl("p", { text: description });
}

export function createSettingsSection(
	containerEl: HTMLElement,
	options: SettingsSectionOptions,
): HTMLElement {
	const details = containerEl.createEl("details", { cls: "falah-settings-section" });
	details.open = openSections.get(options.id) ?? options.open ?? false;
	const summary = details.createEl("summary", { cls: "falah-settings-section-summary" });
	const icon = summary.createSpan({ cls: "falah-settings-section-icon" });
	setIcon(icon, options.icon);
	const copy = summary.createDiv({ cls: "falah-settings-section-copy" });
	copy.createEl("h3", { text: options.title });
	copy.createEl("p", { text: options.description });
	const chevron = summary.createSpan({ cls: "falah-settings-section-chevron" });
	setIcon(chevron, "chevron-right");
	const body = details.createDiv({ cls: "falah-settings-section-body" });
	details.addEventListener("toggle", () => {
		if (details.hasAttribute(SEARCH_ACTIVE_ATTRIBUTE)) return;
		openSections.set(options.id, details.open);
	});
	return body;
}

/** Temporarily reveal a section while filtering without changing the user's
 * remembered disclosure state. */
export function setSettingsSectionSearchState(
	details: HTMLDetailsElement,
	searching: boolean,
	match = false,
): void {
	if (searching) {
		if (!details.hasAttribute(SEARCH_ACTIVE_ATTRIBUTE)) {
			details.setAttribute(SEARCH_PREVIOUS_OPEN_ATTRIBUTE, String(details.open));
			details.setAttribute(SEARCH_ACTIVE_ATTRIBUTE, "");
		}
		details.open = match;
		return;
	}

	if (!details.hasAttribute(SEARCH_ACTIVE_ATTRIBUTE)) return;
	const wasOpen = details.getAttribute(SEARCH_PREVIOUS_OPEN_ATTRIBUTE) === "true";
	details.open = wasOpen;
	details.removeAttribute(SEARCH_PREVIOUS_OPEN_ATTRIBUTE);
	details.removeAttribute(SEARCH_ACTIVE_ATTRIBUTE);
}

export function createSettingsSubheading(containerEl: HTMLElement, title: string): void {
	containerEl.createEl("h4", { cls: "falah-settings-subheading", text: title });
}

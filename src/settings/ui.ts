import { setIcon } from "obsidian";

export interface SettingsSectionOptions {
	id: string;
	title: string;
	description: string;
	icon: string;
}

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
	const section = containerEl.createEl("section", { cls: "falah-settings-section", attr: { "aria-label": options.title, "data-settings-section": options.id } });
	const summary = section.createDiv({ cls: "falah-settings-section-header" });
	const icon = summary.createSpan({ cls: "falah-settings-section-icon" });
	setIcon(icon, options.icon);
	const copy = summary.createDiv({ cls: "falah-settings-section-copy" });
	copy.createEl("h3", { text: options.title });
	copy.createEl("p", { text: options.description });
	const body = section.createDiv({ cls: "falah-settings-section-body" });
	return body;
}

export function createSettingsSubheading(containerEl: HTMLElement, title: string): void {
	containerEl.createEl("h4", { cls: "falah-settings-subheading", text: title });
}

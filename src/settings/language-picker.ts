import { App, FuzzySuggestModal } from "obsidian";

interface LanguageOption { value: string; name: string }

/** Uses Obsidian's searchable picker and keyboard navigation. */
export class LanguagePicker extends FuzzySuggestModal<LanguageOption> {
	constructor(app: App, private options: LanguageOption[], private select: (value: string) => void, placeholder: string) {
		super(app);
		this.setPlaceholder(placeholder);
	}
	getItems(): LanguageOption[] { return this.options; }
	getItemText(item: LanguageOption): string { return item.name; }
	onChooseItem(item: LanguageOption): void { this.select(item.value); }
}

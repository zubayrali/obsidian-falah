import { Menu, setIcon } from "obsidian";
import type { VerseAction, VerseContext, VerseMenuItem } from "../verse-actions";

/** Resolve registered verse actions and display them using Obsidian's menu. */
export async function openVerseActionMenu(
	actions: VerseAction[],
	context: VerseContext,
	event: MouseEvent,
	emptyLabel: string,
): Promise<void> {
	const menu = new Menu();
	let any = false;
	for (const action of actions) {
		let items: VerseMenuItem[];
		try {
			items = await action.items(context);
		} catch {
			items = [];
		}
		for (const item of items) {
			any = true;
			addMenuItem(menu, item);
		}
	}
	if (!any) {
		menu.addItem((item) => item.setTitle(emptyLabel).setDisabled(true));
	}
	menu.showAtMouseEvent(event);
}

function addMenuItem(menu: Menu, item: VerseMenuItem): void {
	let flattenInto: Menu | undefined;
	menu.addItem((menuItem) => {
		menuItem.setTitle(item.title);
		if (item.icon) menuItem.setIcon(item.icon);
		if (item.section) menuItem.setSection(item.section);
		if (item.checked !== undefined) menuItem.setChecked(item.checked);
		const setSubmenu = (menuItem as unknown as { setSubmenu?: () => Menu }).setSubmenu;
		if (item.submenu?.length && typeof setSubmenu === "function") {
			const submenu = setSubmenu.call(menuItem);
			for (const child of item.submenu) addMenuItem(submenu, child);
		} else if (item.submenu?.length) {
			flattenInto = menu;
		} else if (item.onClick) {
			menuItem.onClick(() => void item.onClick!());
		}
	});
	if (flattenInto && item.submenu) {
		for (const child of item.submenu) addMenuItem(flattenInto, child);
	}
}

export function renderTafsirBlock(
	row: HTMLElement,
	title: string,
	text: string,
	removable: boolean,
	removeAriaLabel: string,
	onRemove?: () => void,
): void {
	const details = row.createEl("details", { cls: "falah-reader-tafsir" });
	details.open = removable;
	const summary = details.createEl("summary");
	summary.createSpan({ text: title });
	if (removable && onRemove) {
		const remove = summary.createEl("button", {
			cls: "falah-reader-tafsir-remove falah-icon-button",
			attr: { "aria-label": removeAriaLabel },
		});
		setIcon(remove, "x");
		remove.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			onRemove();
		};
	}
	details.createDiv({ text, attr: { dir: /[؀-ۿ]/.test(text) ? "rtl" : "ltr" } });
}

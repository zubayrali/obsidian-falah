import { Menu } from "obsidian";
import type { IslamicReference } from "./ref";
import type { ReferenceAction, VerseActionItem } from "./api";

export async function resolveReferenceActionItems(
	actions: ReferenceAction[],
	ref: IslamicReference,
): Promise<VerseActionItem[]> {
	const resolved = await Promise.all(actions.map(async (action) => {
		try {
			return await action.items(ref);
		} catch (error) {
			console.warn(`Falah: reference action ${action.id} failed`, error);
			return [];
		}
	}));
	return resolved.flat();
}

export async function openReferenceActionMenu(
	actions: ReferenceAction[],
	ref: IslamicReference,
	event: MouseEvent,
): Promise<void> {
	const items = await resolveReferenceActionItems(actions, ref);
	if (!items.length) return;
	const menu = new Menu();
	for (const item of items) {
		menu.addItem((entry) => {
			entry.setTitle(item.title);
			if (item.icon) entry.setIcon(item.icon);
			if (item.section) entry.setSection(item.section);
			if (item.checked !== undefined) entry.setChecked(item.checked);
			if (item.onClick) entry.onClick(() => item.onClick!());
		});
	}
	menu.showAtMouseEvent(event);
}

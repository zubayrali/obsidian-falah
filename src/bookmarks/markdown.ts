// Human-readable Markdown export and Markdown/JSON import. Pure; the anchor is
// always produced/consumed through ref.ts, never hand-formatted.

import { parseRefUri, toMarkdownLink, toUri } from "../ref";
import { bookmarkId, emptyStore, parseStore, BOOKMARKS_VERSION,
	type BookmarkStore, type Bookmark } from "./schema";

/** `# group` headings; `- [Label](falah://…) — note` items. */
export function exportMarkdown(store: BookmarkStore): string {
	const blocks = store.groups.map((g) => {
		const lines = [`# ${g.name}`, ""];
		for (const item of g.items) {
			const ref = parseRefUri(item.anchor);
			const link = ref ? toMarkdownLink(ref) : `[${item.anchor}](${item.anchor})`;
			lines.push(item.note ? `- ${link} — ${item.note}` : `- ${link}`);
		}
		return lines.join("\n");
	});
	return `# Falah Bookmarks\n\n${blocks.join("\n\n")}\n`;
}

const LINK_RE = /\[[^\]]*\]\((falah:\/\/[^)\s]+)\)(?:\s*[—-]\s*(.*))?/;

/** Import Markdown (headings = groups) or a JSON store. Returns a fresh store;
 *  the caller merges it into the live one. Never throws. */
export function importText(text: string): BookmarkStore {
	const trimmed = text.trim();
	if (trimmed.startsWith("{")) {
		const parsed = parseStore(trimmed);
		if (parsed.groups.length) return parsed;
	}
	const store = emptyStore();
	let group = { id: "imported", name: "Imported", order: 0, items: [] as Bookmark[] };
	store.groups.push(group);
	let order = 0;
	for (const line of text.split("\n")) {
		const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
		if (heading && heading[1].toLowerCase() !== "falah bookmarks") {
			group = { id: `g${order}`, name: heading[1], order: order++, items: [] };
			store.groups.push(group);
			continue;
		}
		const m = LINK_RE.exec(line);
		if (!m) continue;
		const ref = parseRefUri(m[1]);
		if (!ref) continue;
		const anchor = toUri(ref);
		group.items.push({
			id: bookmarkId(anchor),
			anchor,
			note: m[2]?.trim() || undefined,
			added: 0,
		});
	}
	// Drop the seed "Imported" group if headings supplied real ones.
	store.groups = store.groups.filter((g, i) => g.items.length || (i === 0 && store.groups.length === 1));
	store.version = BOOKMARKS_VERSION;
	return store;
}

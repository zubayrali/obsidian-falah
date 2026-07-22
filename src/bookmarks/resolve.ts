// Pure degradation logic: given a snapshot of what's installed, decide how a row
// renders. Never removes anything — missing content only downgrades the row.

import { parseRefUri, toLabel } from "../ref";
import type { Bookmark } from "./schema";

export interface AvailabilitySnapshot {
	editions: Set<string>;   // installed translation/tafsir edition ids
	collections: Set<string>; // installed hadith collection ids
}

export interface RowState {
	anchorOk: boolean;
	lensState: "none" | "ok" | "dormant";
	label: string;
	badge?: string;
}

export function resolveRow(item: Bookmark, snap: AvailabilitySnapshot): RowState {
	const ref = parseRefUri(item.anchor);
	const anchorOk = ref !== null; // structural validity only — install state never invalidates an anchor
	const label = ref ? toLabel(ref) : item.anchor;

	let badge: string | undefined;
	if (!anchorOk) {
		badge = "Invalid reference";
	} else if (ref.kind === "hadith" && !snap.collections.has(ref.collection)) {
		badge = `${ref.collection} not installed`; // stub — kept, recoverable, never deleted
	}

	let lensState: RowState["lensState"] = "none";
	if (item.lens) {
		if (snap.editions.has(item.lens.editionId)) {
			lensState = "ok";
		} else {
			lensState = "dormant";
			badge = `${item.lens.editionId} not installed — reinstall to restore`;
		}
	}
	return { anchorOk, lensState, label, badge };
}

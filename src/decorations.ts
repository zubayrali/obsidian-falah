// Live Preview layer: replaces [label](falah://...) links with clickable chips.
// Source mode is never decorated, and a link the selection touches stays raw
// so the underlying Markdown remains directly editable.

import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import type FalahPlugin from "./main";
import { IslamicReference, findReferences, toLabel } from "./ref";

class ChipWidget extends WidgetType {
	constructor(
		private plugin: FalahPlugin,
		private ref: IslamicReference,
		private label: string,
		private uri: string
	) {
		super();
	}

	eq(other: ChipWidget): boolean {
		return other.uri === this.uri && other.label === this.label;
	}

	toDOM(): HTMLElement {
		const el = createSpan();
		el.className = `falah-chip falah-chip-${this.ref.kind}`;
		el.textContent = this.label || toLabel(this.ref);
		el.setAttribute("role", "button");
		el.setAttribute("tabindex", "0");
		// mousedown, not click: a click first moves the CM selection into the link,
		// which removes this widget before the click would land
		el.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			this.plugin.openDetail(this.ref);
		});
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.plugin.openDetail(this.ref);
		});
		return el;
	}
}

export function livePreviewChips(plugin: FalahPlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = build(view, plugin);
			}

			update(u: ViewUpdate) {
				if (u.docChanged || u.selectionSet || u.viewportChanged) {
					this.decorations = build(u.view, plugin);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

function build(view: EditorView, plugin: FalahPlugin): DecorationSet {
	if (!view.state.field(editorLivePreviewField)) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		for (const found of findReferences(text)) {
			const start = from + found.index;
			const end = start + found.match.length;
			if (view.state.selection.ranges.some((r) => r.from <= end && r.to >= start)) continue;
			builder.add(
				start,
				end,
				Decoration.replace({ widget: new ChipWidget(plugin, found.ref, found.label, found.uri) })
			);
		}
	}
	return builder.finish();
}

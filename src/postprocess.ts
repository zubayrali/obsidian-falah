// Reading mode layer: swaps falah:// anchors for the same clickable chips
// Live Preview shows, so both modes behave like one product.

import { MarkdownPostProcessor } from "obsidian";
import type FalahPlugin from "./main";
import { parseRefUri, toLabel } from "./ref";

export function falahPostProcessor(plugin: FalahPlugin): MarkdownPostProcessor {
	return (el) => {
		for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>("a"))) {
			const href = a.getAttribute("href") ?? a.getAttribute("data-href") ?? "";
			if (!href.startsWith("falah://")) continue;
			const ref = parseRefUri(href);
			if (!ref) continue; // malformed reference: leave the raw link visible, never mutate
			const chip = document.createElement("span");
			chip.className = `falah-chip falah-chip-${ref.kind}`;
			chip.textContent = a.textContent || toLabel(ref);
			chip.setAttribute("role", "button");
			chip.setAttribute("tabindex", "0");
			chip.addEventListener("click", (e) => {
				e.preventDefault();
				plugin.openDetail(ref);
			});
			chip.addEventListener("keydown", (e) => {
				if (e.key === "Enter") plugin.openDetail(ref);
			});
			a.replaceWith(chip);
		}
	};
}

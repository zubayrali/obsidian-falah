// Shared single-field name prompt. Obsidian has no built-in prompt() modal, so
// this is the one place that fills the gap (used for "New collection…").

import { App, Modal, Setting } from "obsidian";

/** Minimal single-field name prompt. Resolves the trimmed value, or null if
 *  cancelled/empty. Obsidian has no built-in prompt, so this is the shared one.
 *  Reused for both "New collection" and "Rename collection", so the submit
 *  button label is caller-supplied rather than hardcoded. */
export function promptName(app: App, title: string, initial = "", submitLabel = "Create"): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new Modal(app);
		let value = initial;
		let submitted = false;
		modal.titleEl.setText(title);
		new Setting(modal.contentEl).addText((t) => {
			t.setValue(initial).onChange((v) => (value = v));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { submitted = true; modal.close(); }
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(modal.contentEl).addButton((b) =>
			b.setButtonText(submitLabel).setCta().onClick(() => { submitted = true; modal.close(); })
		);
		modal.onClose = () => resolve(submitted && value.trim() ? value.trim() : null);
		modal.open();
	});
}

import { App, Modal, Setting } from "obsidian";

export interface ConfirmActionOptions {
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
}

class ConfirmActionModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly options: ConfirmActionOptions,
		private readonly resolveResult: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("falah-confirm-modal");
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl("p", { text: this.options.message });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(this.options.cancelLabel).onClick(() => this.finish(false)))
			.addButton((button) => {
				button.setButtonText(this.options.confirmLabel).setWarning().onClick(() => this.finish(true));
				window.setTimeout(() => button.buttonEl.focus(), 0);
			});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) this.resolveResult(false);
	}

	private finish(confirmed: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.resolveResult(confirmed);
		this.close();
	}
}

export function confirmAction(app: App, options: ConfirmActionOptions): Promise<boolean> {
	return new Promise((resolve) => new ConfirmActionModal(app, options, resolve).open());
}

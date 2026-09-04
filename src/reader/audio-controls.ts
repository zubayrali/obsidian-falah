import { t } from "../i18n";
import { setIcon } from "obsidian";
import type {
	AudioRef,
	RecitationController,
	RecitationState,
} from "../audio/recitation";

/** The reader-owned values the audio UI needs; everything else stays hidden. */
export interface ReaderAudioHost {
	currentRef(): AudioRef;
	reciterName?(): string;
	toolbar(): HTMLElement;
	body(): HTMLElement;
	onRecitationChange?(state: RecitationState): void;
}

/** Owns the reader recitation controls, subscription, and playing-row state. */
export class ReaderAudioControls {
	private unsubscribe?: () => void;
	private repeatStart?: AudioRef;

	constructor(
		private readonly recitation: RecitationController,
		private readonly host: ReaderAudioHost,
	) {}

	connect(): void {
		this.unsubscribe?.();
		this.unsubscribe = this.recitation.onChange((state) => this.sync(state));
	}

	disconnect(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	mount(parent: HTMLElement): void {
		const strings = t();
		const group = parent.createDiv({ cls: "falah-reader-audio" });
		const transport = group.createDiv({ cls: "falah-reader-audio-transport" });
		const previous = transport.createEl("button", {
			cls: "falah-reader-btn falah-icon-button",
			attr: { "aria-label": strings.cmdRecitationPrevious },
		});
		setIcon(previous, "skip-back");
		previous.onclick = () => void this.recitation.dispatch({ type: "previous" });

		const state = this.recitation.snapshot();
		const primary = transport.createEl("button", {
			cls: "falah-reader-btn falah-icon-button falah-reader-audio-primary",
			attr: { "aria-label": strings.cmdRecitationPlayPause },
		});
		setIcon(primary, this.primaryIcon(state));
		primary.onclick = () => {
			const current = this.recitation.snapshot();
			void this.recitation.dispatch({
				type: current.current ? "toggle" : "play",
				ref: current.current ? undefined : this.host.currentRef(),
			});
		};

		const next = transport.createEl("button", {
			cls: "falah-reader-btn falah-icon-button",
			attr: { "aria-label": strings.cmdRecitationNext },
		});
		setIcon(next, "skip-forward");
		next.onclick = () => void this.recitation.dispatch({ type: "next" });

		const nowPlaying = group.createDiv({ cls: "falah-reader-audio-now-playing" });
		nowPlaying.createSpan({ cls: "falah-reader-audio-eyebrow", text: strings.readerAudioPlayer });
		nowPlaying.createSpan({ cls: "falah-reader-audio-reciter", text: this.host.reciterName?.() ?? strings.setReciterName });
		nowPlaying.createSpan({ cls: "falah-reader-audio-position" });

		const utilities = group.createDiv({ cls: "falah-reader-audio-utilities" });
		const start = utilities.createEl("button", {
			cls: "falah-reader-btn falah-icon-button falah-reader-repeat-start",
			attr: { "aria-label": strings.readerRepeatStart },
		});
		setIcon(start, "list-start");
		start.onclick = () => { this.repeatStart = this.host.currentRef(); };

		const repeat = utilities.createEl("button", {
			cls: "falah-reader-btn falah-icon-button falah-reader-repeat",
			attr: { "aria-label": strings.readerRepeatRange },
		});
		setIcon(repeat, "repeat-2");
		repeat.onclick = () => {
			const current = this.recitation.snapshot();
			if (current.repeat) {
				void this.recitation.dispatch({ type: "clear-repeat" });
				return;
			}
			const end = this.host.currentRef();
			void this.recitation.dispatch({ type: "set-repeat", from: this.repeatStart ?? end, to: end });
		};

		utilities.createSpan({ cls: "falah-reader-audio-status" });
		this.sync(state);
	}

	private primaryIcon(state: RecitationState): string {
		return state.playing ? "pause" : state.status === "error" ? "rotate-ccw" : "play";
	}

	private sync(state: RecitationState): void {
		const toolbar = this.host.toolbar();
		const button = toolbar.querySelector<HTMLButtonElement>(".falah-reader-audio-primary");
		if (button) setIcon(button, this.primaryIcon(state));
		const repeat = toolbar.querySelector<HTMLButtonElement>(".falah-reader-repeat");
		repeat?.toggleClass("is-active", !!state.repeat);
		repeat?.setAttr("aria-pressed", String(!!state.repeat));
		const status = toolbar.querySelector<HTMLElement>(".falah-reader-audio-status");
		status?.setText(state.error?.message ?? (state.source === "cache" ? t().readerAudioCached : ""));
		const position = toolbar.querySelector<HTMLElement>(".falah-reader-audio-position");
		const ref = state.current ?? this.host.currentRef();
		position?.setText(t().readerAudioPosition(ref.surah, ref.ayah));

		const body = this.host.body();
		body.querySelectorAll(".falah-reader-ayah-playing").forEach((row) => row.removeClass("falah-reader-ayah-playing"));
		if (state.current?.surah === this.host.currentRef().surah) {
			const row = body.querySelector<HTMLElement>(`.falah-reader-ayah[data-ayah="${state.current.ayah}"]`);
			row?.addClass("falah-reader-ayah-playing");
			if (state.playing) row?.scrollIntoView({ block: "center", behavior: "smooth" });
		}
		this.host.onRecitationChange?.(state);
	}
}

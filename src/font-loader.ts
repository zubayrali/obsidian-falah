// Obsidian/build-runtime side of the font system: inlines the bundled font
// assets, builds + injects @font-face CSS (popout-safe), scans vault fonts, and
// enumerates OS fonts. NOT imported by any test (it imports binary assets).

import type { App } from "obsidian";
import amiriQuran from "../assets/fonts/amiri-quran.woff2";
import kfgqpcHafs from "../assets/fonts/kfgqpc-hafs.woff2";
import pdmsSaleem from "../assets/fonts/pdms-saleem.ttf";
import notoNaskh from "../assets/fonts/noto-naskh.woff2";
import { BUNDLED_FONTS, dedupeFamilies, familyFromFontFile } from "./fonts";

const BUNDLED_URLS: Record<string, string> = {
	"amiri-quran.woff2": amiriQuran,
	"kfgqpc-hafs.woff2": kfgqpcHafs,
	"pdms-saleem.ttf": pdmsSaleem,
	"noto-naskh.woff2": notoNaskh,
};

interface LoadedFont {
	family: string;
	url: string;
	format: string;
}

function formatFor(path: string): string {
	if (/\.woff2$/i.test(path)) return "woff2";
	if (/\.woff$/i.test(path)) return "woff";
	if (/\.otf$/i.test(path)) return "opentype";
	return "truetype";
}

function faceRule(f: LoadedFont): string {
	return `@font-face{font-family:"${f.family}";src:url(${f.url}) format("${f.format}");font-display:swap;}`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/** Detect installed OS fonts (desktop Chromium only). Feature-detected; returns
 *  [] when unavailable. MUST be called from a user gesture (a button click) or it
 *  throws SecurityError — callers wrap in try/catch. */
export async function enumerateSystemFonts(): Promise<string[]> {
	const q = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> })
		.queryLocalFonts;
	if (typeof q !== "function") return [];
	const fonts = await q();
	return dedupeFamilies(fonts.map((f) => f.family));
}

export class FontManager {
	private css = "";
	private vault: LoadedFont[] = [];

	constructor(private app: App, private fontsDir: string) {}

	vaultFamilies(): string[] {
		return this.vault.map((f) => f.family);
	}

	/** Re-scan the vault fonts folder, rebuild the @font-face CSS, and re-inject
	 *  into the main document. */
	async reload(): Promise<void> {
		this.vault = await this.scanVault();
		const bundled: LoadedFont[] = BUNDLED_FONTS.map((f) => ({
			family: f.family,
			url: BUNDLED_URLS[f.file],
			format: formatFor(f.file),
		}));
		this.css = [...bundled, ...this.vault].map(faceRule).join("\n");
		this.injectInto(document);
	}

	/** Inject (or refresh) the cached @font-face CSS into a document — call for the
	 *  main window and again for each pop-out window (window-open event). */
	injectInto(doc: Document): void {
		let el = doc.getElementById("falah-fonts") as HTMLStyleElement | null;
		if (!el) {
			el = doc.createElement("style");
			el.id = "falah-fonts";
			doc.head.appendChild(el);
		}
		el.textContent = this.css;
	}

	private async scanVault(): Promise<LoadedFont[]> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.fontsDir))) return [];
		const { files } = await adapter.list(this.fontsDir);
		const out: LoadedFont[] = [];
		for (const path of files) {
			if (!/\.(woff2|woff|ttf|otf)$/i.test(path)) continue;
			try {
				const buf = await adapter.readBinary(path);
				const mime = /\.woff2$/i.test(path)
					? "font/woff2"
					: /\.woff$/i.test(path)
						? "font/woff"
						: /\.otf$/i.test(path)
							? "font/otf"
							: "font/ttf";
				out.push({
					family: familyFromFontFile(path),
					url: `data:${mime};base64,${arrayBufferToBase64(buf)}`,
					format: formatFor(path),
				});
			} catch {
				// skip an unreadable font file
			}
		}
		return out;
	}
}

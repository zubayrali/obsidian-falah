// Offline-first hadith resolver: installed collection → bundled Nawawi 40 →
// live provider. Isolated from the Quran source; shares only the generic
// content store/index. Every miss degrades to the next tier; the live provider
// is the existing HadithCdnProvider passed in as `live`.

import { NotInstalledError } from "../schema";
import type { HadithContent } from "../schema";
import type { HadithRef } from "../../ref";
import { HADITH_COLLECTION_NAMES } from "../../ref";
import { hadithExternalUrl } from "../../providers";
import type { ResourceStore } from "../content/resource-store";
import type { InstallIndex } from "../content/install-index";
import type { HadithCoreLoader } from "./core";
import type { HadithCollection, HadithCollectionDescriptor, NormHadith } from "./schema";

export const HADITH_DOMAIN = "hadith";

export interface LiveHadith {
	getHadith(ref: HadithRef): Promise<HadithContent>;
}

export interface BrowsableCollection {
	id: string;
	collection: string;
	name: string;
	language: string;
	count: number;
	tier: "downloaded" | "bundled";
}

function toContent(ref: HadithRef, h: NormHadith): HadithContent {
	const content: HadithContent = {
		ref,
		externalUrl: hadithExternalUrl(ref),
		bookName: HADITH_COLLECTION_NAMES[ref.collection] ?? ref.collection,
	};
	if (h.arabic) content.arabic = h.arabic;
	if (h.translation) content.translation = h.translation;
	if (h.narrator) content.narrator = h.narrator;
	if (h.grades && h.grades.length) {
		content.grades = h.grades.map((g) => [g.name, g.grade].filter(Boolean).join(": ")).join(", ");
	}
	return content;
}

function findHadith(c: HadithCollection, num: number): NormHadith | undefined {
	return c.hadiths.find((h) => h.number === num);
}

export class HadithResolver {
	constructor(
		private store: ResourceStore,
		private index: InstallIndex,
		private core: HadithCoreLoader,
		private live: LiveHadith
	) {}

	async getHadith(ref: HadithRef): Promise<HadithContent> {
		const num = parseInt(ref.number, 10);
		if (Number.isFinite(num)) {
			// 1) installed collections for this slug (prefer one that has a translation)
			const entries = (await this.index.list()).filter(
				(e) => e.type === "hadith-collection" && (e.meta?.collection === ref.collection || e.id.includes(`-${ref.collection}-`))
			);
			let arabicOnlyHit: NormHadith | undefined;
			for (const e of entries) {
				let c: HadithCollection;
				try {
					c = await this.store.load<HadithCollection>(HADITH_DOMAIN, e.id);
				} catch {
					continue;
				}
				if (c.collection !== ref.collection) continue;
				const h = findHadith(c, num);
				if (!h) continue;
				if (h.translation) return toContent(ref, h);
				arabicOnlyHit ??= h;
			}
			if (arabicOnlyHit) return toContent(ref, arabicOnlyHit);
			// 2) bundled
			const bundled = this.core.get(ref.collection);
			if (bundled) {
				const h = findHadith(bundled, num);
				if (h) return toContent(ref, h);
			}
		}
		// 3) live
		return this.live.getHadith(ref);
	}

	async getCollection(id: string): Promise<HadithCollection> {
		if (id.startsWith("bundled-")) {
			const bundled = this.core.get(id.slice("bundled-".length));
			if (bundled) return bundled;
			throw new NotInstalledError(id, `${id} not bundled`);
		}
		return this.store.load<HadithCollection>(HADITH_DOMAIN, id);
	}

	async install(desc: HadithCollectionDescriptor, collection: HadithCollection): Promise<void> {
		await this.store.write(HADITH_DOMAIN, desc.id, collection);
		await this.index.put({
			id: desc.id,
			type: "hadith-collection",
			name: desc.name,
			language: desc.language,
			tier: "downloaded",
			provenance: desc.source,
			version: desc.version,
			sizeBytes: desc.sizeBytes,
			count: desc.count ?? collection.hadiths.length,
			installedAt: Date.now(),
			meta: { collection: desc.collection },
		});
	}

	/** Installed + bundled collections, uniform, for the browse-to-insert picker.
	 *  An installed collection shadows the bundled one of the same slug. */
	async listBrowsable(): Promise<BrowsableCollection[]> {
		const installed = await this.listInstalled();
		const out: BrowsableCollection[] = installed.map((d) => ({
			id: d.id,
			collection: d.collection,
			name: d.name,
			language: d.language,
			count: d.count ?? 0,
			tier: "downloaded",
		}));
		const have = new Set(installed.map((d) => d.collection));
		for (const c of this.core.listCollections()) {
			if (have.has(c.collection)) continue;
			out.push({
				id: `bundled-${c.collection}`,
				collection: c.collection,
				name: c.name,
				language: c.language,
				count: c.hadiths.length,
				tier: "bundled",
			});
		}
		return out;
	}

	async remove(id: string): Promise<void> {
		await this.store.remove(HADITH_DOMAIN, id);
		await this.index.remove(id);
	}

	async listInstalled(): Promise<HadithCollectionDescriptor[]> {
		return (await this.index.list())
			.filter((e) => e.type === "hadith-collection")
			.map((e) => ({
				id: e.id,
				source: e.provenance ?? "",
				collection: String(e.meta?.collection ?? e.id.split("-")[1] ?? ""),
				language: e.language,
				name: e.name,
				version: e.version,
				sizeBytes: e.sizeBytes,
				count: e.count,
			}));
	}
}

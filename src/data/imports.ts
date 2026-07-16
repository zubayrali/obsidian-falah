// Manual-import scan (spec §5.2 tier 3): reads JSON packs dropped into the
// plugin's imports/ folder, validates + normalizes each, ingests into the store,
// and records it in the registry. Depends only on the plain FileIO/DataStore/
// Registry seams (no obsidian import) so it is unit-testable under vitest.

import { SchemaError } from "./schema";
import { normalizePack } from "./normalize";
import { categoryForType } from "./store";
import type { DataStore, FileIO } from "./store";
import type { Registry } from "./registry";

export interface ImportDeps {
	io: FileIO;
	store: DataStore;
	registry: Registry;
}

/** Local copy of providers.ts's errMsg so this module stays obsidian-free
 *  (providers.ts imports "obsidian"). Kept trivial and in sync intentionally. */
function msg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Scan imports/ for *.json packs. Never throws: a missing imports/ folder yields
 *  an empty result, a failed directory read is reported as a single failed entry,
 *  and per-file failures are collected (one bad pack never aborts the others). */
export async function scanImportsFolder(deps: ImportDeps): Promise<{ ok: string[]; failed: string[] }> {
	const ok: string[] = [];
	const failed: string[] = [];
	try {
		if (!(await deps.io.exists("imports"))) return { ok, failed };
		const { files } = await deps.io.list("imports");
		for (const file of files.filter((f) => f.endsWith(".json"))) {
			try {
				const raw = await deps.io.read(`imports/${file}`);
				const parsed = JSON.parse(raw) as { type?: unknown };
				if (parsed.type !== "translation" && parsed.type !== "tafsir") {
					throw new SchemaError(`unknown pack type "${String(parsed.type)}"`);
				}
				const { descriptor, bySurah } = normalizePack(parsed, parsed.type);
				const { surahs } = await deps.store.ingestPack(categoryForType(parsed.type), { descriptor, bySurah });
				await deps.registry.recordImport(descriptor, surahs);
				ok.push(file);
			} catch (e) {
				failed.push(`${file} (${msg(e)})`);
			}
		}
	} catch (e) {
		failed.push(`imports/ (${msg(e)})`);
	}
	return { ok, failed };
}

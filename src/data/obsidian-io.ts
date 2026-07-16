// The Obsidian runtime boundary for the data layer: concrete FileIO/FetchJson
// factories built over Obsidian's vault DataAdapter and requestUrl. Kept in its
// own module — importing Obsidian ONLY as erased `import type` — so it carries no
// runtime dependency on the "obsidian" package and can be unit-tested under vitest
// with plain in-memory fakes (unlike main.ts, which pulls in Plugin/Notice/Modal
// and cannot be imported by the test runner).

import { NetworkError } from "./schema";
import type { FileIO } from "./store";
import type { FetchJson } from "./download";

/** The slice of Obsidian's `DataAdapter` the store/registry actually use. Declared
 *  structurally so this module never imports the obsidian runtime; the real
 *  `app.vault.adapter` satisfies it. */
export interface DataAdapterLike {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	remove(path: string): Promise<void>;
	rmdir(path: string, recursive: boolean): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	stat(path: string): Promise<{ type: "file" | "folder" } | null>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

/** The slice of Obsidian's `requestUrl` this module depends on. */
export type RequestUrlLike = (options: {
	url: string;
	throw?: boolean;
}) => Promise<{ status: number; json: unknown }>;

/** Wraps a DataAdapter-shaped object as a `FileIO`, scoping every path under
 *  `baseDir` (the plugin's own directory, spec §6). An empty/undefined `baseDir`
 *  leaves paths unprefixed rather than emitting a leading-slash path. */
export function makeFileIO(adapter: DataAdapterLike, baseDir: string): FileIO {
	const full = (p: string) => (baseDir ? `${baseDir}/${p}` : p);
	return {
		async read(path) {
			return adapter.read(full(path));
		},
		async write(path, data) {
			await adapter.write(full(path), data);
		},
		async exists(path) {
			return adapter.exists(full(path));
		},
		async mkdir(path) {
			await adapter.mkdir(full(path));
		},
		async remove(path) {
			const p = full(path);
			if (!(await adapter.exists(p))) return;
			const stat = await adapter.stat(p);
			if (stat?.type === "folder") await adapter.rmdir(p, true);
			else await adapter.remove(p);
		},
		async rename(oldPath, newPath) {
			// Obsidian's adapter.rename refuses to overwrite an existing destination
			// (throws "destination file already exists"), unlike POSIX fs.rename. Our
			// atomic writes (tmp -> rename over the live file) rely on overwrite, so
			// clear the destination first. Window where neither exists is acceptable:
			// tmp still holds the full data and a re-run re-fetches. (spec §6 atomic write)
			const dest = full(newPath);
			if (await adapter.exists(dest)) await adapter.remove(dest);
			await adapter.rename(full(oldPath), dest);
		},
		async list(path) {
			const prefix = full(path);
			const res = await adapter.list(prefix);
			// DataAdapter.list returns vault-relative *full* paths; store/registry
			// expect names relative to the queried directory, so strip the prefix + "/".
			const strip = (s: string) => s.slice(prefix.length + 1);
			return { files: res.files.map(strip), folders: res.folders.map(strip) };
		},
	};
}

/** Wraps a requestUrl-shaped function as a `FetchJson`. A non-2xx status becomes a
 *  typed `NetworkError` (spec: every data-layer failure crosses the seam typed);
 *  a success returns the parsed JSON body. */
export function makeFetchJson(requestUrl: RequestUrlLike): FetchJson {
	return async (url: string) => {
		const res = await requestUrl({ url, throw: false });
		if (res.status < 200 || res.status >= 300) {
			throw new NetworkError(`GET ${url} → ${res.status}`);
		}
		return res.json;
	};
}

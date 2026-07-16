// Shared test fakes for the data layer. NOT a test file (no `.test` in the name,
// so it never matches the vitest glob) — importing a `.test.ts` module instead
// would re-execute that file's whole suite under the importer.

import type { FileIO } from "./store";

/** In-memory FileIO fake: a flat path→content map, with call-order tracking so
 *  atomicity (tmp → rename) is directly observable. */
export function makeFakeIO(initial: Record<string, string> = {}): FileIO & { calls: string[] } {
	const files = new Map<string, string>(Object.entries(initial));
	const calls: string[] = [];
	return {
		calls,
		async read(path) {
			calls.push(`read:${path}`);
			if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
			return files.get(path)!;
		},
		async write(path, data) {
			calls.push(`write:${path}`);
			files.set(path, data);
		},
		async exists(path) {
			return files.has(path) || [...files.keys()].some((k) => k.startsWith(path + "/"));
		},
		async mkdir(path) {
			calls.push(`mkdir:${path}`);
		},
		async remove(path) {
			calls.push(`remove:${path}`);
			for (const k of [...files.keys()]) if (k === path || k.startsWith(path + "/")) files.delete(k);
		},
		async rename(oldPath, newPath) {
			calls.push(`rename:${oldPath}->${newPath}`);
			const v = files.get(oldPath);
			if (v === undefined) throw new Error(`ENOENT: ${oldPath}`);
			files.delete(oldPath);
			files.set(newPath, v);
		},
		async list(path) {
			const prefix = path + "/";
			const folders = new Set<string>();
			const direct: string[] = [];
			for (const k of files.keys()) {
				if (!k.startsWith(prefix)) continue;
				const rest = k.slice(prefix.length);
				const slash = rest.indexOf("/");
				if (slash === -1) direct.push(rest);
				else folders.add(rest.slice(0, slash));
			}
			return { files: direct, folders: [...folders] };
		},
	};
}

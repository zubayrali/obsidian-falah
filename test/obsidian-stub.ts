// Test-time stand-in for the "obsidian" package, aliased in via vitest.config.ts.
// "obsidian" ships type declarations only (package.json "main" is empty), so it
// cannot be resolved as a real module under Vite/Node — any test whose import
// graph reaches a file that imports a value from "obsidian" (providers.ts,
// main.ts, …) needs this. Only `requestUrl` is exercised by the data-layer
// tests today; extend as later tasks' tests reach more of the Obsidian API.
export function requestUrl(): never {
	throw new Error("requestUrl stub called — inject a fake instead of hitting the real network in tests");
}

// Test-time stand-in for the "obsidian" package, aliased in via vitest.config.ts.
// "obsidian" ships type declarations only (package.json "main" is empty), so it
// cannot be resolved as a real module under Vite/Node — any test whose import
// graph reaches a file that imports a value from "obsidian" (providers.ts,
// main.ts, …) needs this. Extend as later tasks' tests reach more of the
// Obsidian API. These base classes exist only so `class X extends Y` in the
// import graph doesn't throw at module-eval time; no test here actually
// constructs a FalahPlugin/view/modal instance (they use
// `Object.create(Proto.prototype)` to bypass the constructor), so the stub
// bodies stay empty.
export function requestUrl(): never {
	throw new Error("requestUrl stub called — inject a fake instead of hitting the real network in tests");
}

export class Plugin {}
export class PluginSettingTab {}
export class Modal {}
export class ItemView {}
export class EditorSuggest<T> {}
export class SuggestModal<T> {}
export class Setting {}
export class Notice {}
export class Menu {}
export const editorLivePreviewField = {};

import { defineConfig } from "vitest/config";

// "obsidian" ships types only (package.json "main" is empty) so it can never
// resolve as a real ESM module under Vite/Node. Any test whose import graph
// reaches a file with a VALUE import from "obsidian" (providers.ts, main.ts,
// i18n/index.ts's getLanguage, …) needs a stand-in; alias the bare specifier
// to a minimal stub rather than relying on Vitest's `__mocks__` auto-mock
// convention (which requires an explicit `vi.mock("obsidian")` per test file
// and, empirically, still failed to resolve here).
//
// Pathed via import.meta.dirname rather than node:path + __dirname: `npm run
// lint` covers this file, and obsidianmd/no-nodejs-modules (correctly, for
// plugin source) rejects a "node:path" import. Same as the sibling Tadabbur
// repo's vitest.config.ts.
export default defineConfig({
	resolve: {
		alias: {
			obsidian: `${import.meta.dirname}/test/obsidian-stub.ts`,
		},
	},
});

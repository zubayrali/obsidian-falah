import path from "node:path";
import { defineConfig } from "vitest/config";

// "obsidian" ships types only (package.json "main" is empty) so it can never
// resolve as a real ESM module under Vite/Node. Any test whose import graph
// reaches a file with `import { requestUrl } from "obsidian"` (providers.ts,
// main.ts, …) needs a stand-in; alias the bare specifier to a minimal stub
// rather than relying on Vitest's `__mocks__` auto-mock convention (which
// requires an explicit `vi.mock("obsidian")` per test file and, empirically,
// still failed to resolve here).
export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "test/obsidian-stub.ts"),
		},
	},
});

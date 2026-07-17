import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		// Dev-time only (`npm run build:core`), never shipped or executed by the
		// plugin — same category as the two build scripts above. It is a node
		// script, so the mobile-safety rules here do not apply to it.
		'assets/bundled-core/build.ts',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					// tsconfig.json only includes src/**/*.ts, so these tooling files
					// are outside the project service and would otherwise be a parse
					// error under `eslint .` (what CI runs). Listing them lints them;
					// it disables nothing.
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						'vitest.config.ts',
						'test/obsidian-stub.ts',
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Specs run under Vitest in node, where `window` does not exist — a bare
		// `setTimeout` here is the node global, not a document timer, and the
		// rule's `window.setTimeout` fix would throw. The popout-window concern
		// only applies to plugin code running inside Obsidian, so scope the rule
		// to shipped code rather than turning it off everywhere.
		files: ['**/*.test.ts'],
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
);

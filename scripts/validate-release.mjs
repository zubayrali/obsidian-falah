import { access, readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const fail = (message) => {
	console.error(`Release validation failed: ${message}`);
	process.exitCode = 1;
};
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const [manifest, pkg, versions] = await Promise.all([
	readJson("manifest.json"),
	readJson("package.json"),
	readJson("versions.json"),
]);

if (manifest.id !== "falah") fail("manifest id must remain 'falah'");
if (!manifest.name || typeof manifest.name !== "string") fail("manifest name is required");
if (!semver.test(manifest.version ?? "")) fail("manifest version must be semantic x.y.z");
if (pkg.version !== manifest.version) fail("package.json and manifest.json versions must match");
if (!semver.test(manifest.minAppVersion ?? "")) fail("minAppVersion must be semantic x.y.z");
if (versions[manifest.version] !== manifest.minAppVersion) {
	fail("versions.json must map the current plugin version to minAppVersion");
}
if (!manifest.description || typeof manifest.description !== "string") fail("manifest description is required");
if (typeof manifest.isDesktopOnly !== "boolean") fail("isDesktopOnly must be a boolean");

const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== manifest.version) {
	fail(`tag '${tag}' must exactly match manifest version '${manifest.version}' (no v prefix)`);
}

if (process.argv.includes("--artifacts")) {
	for (const artifact of ["main.js", "manifest.json", "styles.css"]) {
		try {
			await access(artifact);
		} catch {
			fail(`missing release artifact: ${artifact}`);
		}
	}
}

if (!process.exitCode) {
	console.log(`Release metadata valid for Falah ${manifest.version} (Obsidian ${manifest.minAppVersion}+)`);
}

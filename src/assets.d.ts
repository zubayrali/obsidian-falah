// esbuild inlines these as data-URI strings via the dataurl loader (see esbuild.config.mjs).
declare module "*.woff2" {
	const url: string;
	export default url;
}
declare module "*.woff" {
	const url: string;
	export default url;
}
declare module "*.ttf" {
	const url: string;
	export default url;
}
declare module "*.otf" {
	const url: string;
	export default url;
}

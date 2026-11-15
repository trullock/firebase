/**
 * The build's defaults: a config only needs what differs. Paths are relative to root, by default the working directory.
 * eventHandlers or scripts set to false aren't listed.
 */
export const defaults = {
	sourceDir: 'domain',
	outDir: 'dist',
	vue: {
		compilerOptions: { whitespace: 'preserve', comments: true }
	},
	eventHandlers: {
		folder: 'eventHandlers',
		output: 'eventHandlers.json'
	},
	scripts: {
		folder: 'scripts',
		output: 'scripts.json'
	}
};

export function resolveConfig(config = {})
{
	let section = name => config[name] === false ? false : { ...defaults[name], ...config[name] };
	return {
		...defaults,
		...config,
		root: config.root ?? process.cwd(),
		vue: section('vue'),
		eventHandlers: section('eventHandlers'),
		scripts: section('scripts')
	};
}

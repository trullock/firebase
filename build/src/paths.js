import path from 'node:path';
import { resolveConfig } from './config.js';

/**
 * Where a build's source and outputs are, for a config (see config.js)
 */
export function buildPaths(config)
{
	config = resolveConfig(config);
	let outDir = path.resolve(config.root, config.outDir);
	return {
		sourceDir: path.resolve(config.root, config.sourceDir),
		outDir,
		output: name => path.join(outDir, name),
		// e.g. <outDir>/domain/wrapper.vue.js for <root>/domain/wrapper.vue
		compiled: srcFile => path.join(outDir, path.relative(config.root, srcFile) + '.js')
	};
}

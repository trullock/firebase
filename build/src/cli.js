#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, watch } from './index.js';
import { buildPaths } from './paths.js';

/**
 * firebase-build [config file] [--watch]
 * A config file default exports what differs from the defaults in config.js; without one, they're used as they are.
 */

let args = process.argv.slice(2);
let configFile = args.find(a => !a.startsWith('--'));
let config = configFile ? (await import(pathToFileURL(path.resolve(configFile)).href)).default : {};

function report(result, err)
{
	if(err)
		console.error('build failed:', err.message);
	else
		console.log(`built ${result.outputs} file(s) from ${result.vueFiles} .vue file(s) and the lists, ${result.written} changed`);
}

if(args.includes('--watch'))
{
	await watch(config, report);
	console.log(`watching ${buildPaths(config).sourceDir} for changes`);
}
else
	report(await build(config));

import fs from 'node:fs';
import path from 'node:path';
import { buildPaths } from './paths.js';
import { resolveConfig } from './config.js';
import { compileVue } from './compileVue.js';
import { findEventHandlers } from './eventHandlers.js';
import { findScripts } from './scripts.js';
import { findMigrations } from './migrations.js';

export { buildPaths } from './paths.js';
export { defaults, resolveConfig } from './config.js';
export { compileVue } from './compileVue.js';
export { findEventHandlers } from './eventHandlers.js';
export { findScripts } from './scripts.js';
export { findMigrations } from './migrations.js';

/**
 * Builds what would otherwise be compiled or parsed at runtime into config.outDir: each .vue file under
 * config.sourceDir compiled to a module, and, if configured, the lists of event handlers by how they run, of scripts and of migrations in the order they run.
 * Only what's changed is written, and anything else in outDir is removed.
 * @param {object} [config] what differs from the defaults in config.js
 * @param {string} [config.root] the directory the other paths are relative to
 * @param {string} [config.sourceDir]
 * @param {string} [config.outDir]
 * @param {{ compilerOptions?: object }} [config.vue]
 * @param {{ folder?: string, output?: string }|false} [config.eventHandlers]
 * @param {{ folder?: string, output?: string }|false} [config.scripts]
 * @param {{ folder?: string, output?: string }|false} [config.migrations]
 */
export async function build(config)
{
	config = resolveConfig(config);
	let { sourceDir, outDir, output, compiled } = buildPaths(config);
	if(!path.relative(outDir, config.root).startsWith('..') || !path.relative(outDir, sourceDir).startsWith('..'))
		throw new Error(`outDir ${outDir} would hold the source, and everything in it not built is deleted`);

	let outputs = new Map();

	if(config.eventHandlers)
		outputs.set(output(config.eventHandlers.output), JSON.stringify(await findEventHandlers(sourceDir, config.eventHandlers), null, '\t'));

	if(config.scripts)
		outputs.set(output(config.scripts.output), JSON.stringify(findScripts(sourceDir, config.scripts), null, '\t'));

	if(config.migrations)
		outputs.set(output(config.migrations.output), JSON.stringify(findMigrations(sourceDir, config.migrations), null, '\t'));

	let vueFiles = fs.readdirSync(sourceDir, { recursive: true }).filter(f => f.endsWith('.vue'));
	for(let file of vueFiles)
	{
		let srcFile = path.join(sourceDir, file);
		let outFile = compiled(srcFile);
		outputs.set(outFile, await compileVue(srcFile, outFile, config.vue?.compilerOptions));
	}

	// only what's changed is written, so anything watching outDir (e.g. the Firebase emulator) doesn't reload for nothing
	let written = 0;
	for(let [file, content] of outputs)
	{
		if(fs.existsSync(file) && fs.readFileSync(file, 'utf8') == content)
			continue;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
		written++;
	}

	if(fs.existsSync(outDir))
	{
		let entries = fs.readdirSync(outDir, { recursive: true }).map(f => path.join(outDir, f));
		for(let file of entries)
			if(fs.statSync(file).isFile() && !outputs.has(file))
				fs.rmSync(file);

		// deepest first, so a folder emptied by removing its subfolders is removed too
		for(let dir of entries.filter(e => fs.statSync(e).isDirectory()).sort((a, b) => b.length - a.length))
			if(!fs.readdirSync(dir).length)
				fs.rmdirSync(dir);
	}

	return { vueFiles: vueFiles.length, outputs: outputs.size, written };
}

/**
 * Builds, then builds again whenever config.sourceDir changes. report is called with each build's result, or its error.
 */
export async function watch(config, report)
{
	config = resolveConfig(config);
	let { sourceDir } = buildPaths(config);
	report(await build(config));

	let timer = null;
	let building = Promise.resolve();
	fs.watch(sourceDir, { recursive: true }, () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			building = building
				.then(() => build(config))
				.then(result => report(result), err => report(null, err));
		}, 200);
	});
}

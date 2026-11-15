import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { defaults } from './config.js';

/**
 * Whether a .js event handler is deferred, from its `export const deferred = true|false`.
 * Read from its source rather than by importing it, so handlers can still be loaded lazily.
 */
function isDeferred(file, source)
{
	let { program } = parse(source, { sourceType: 'module', sourceFilename: file });
	let exported = program.body.filter(node => node.type == 'ExportNamedDeclaration');

	let declarator = exported
		.filter(node => node.declaration?.type == 'VariableDeclaration' && node.declaration.kind == 'const')
		.flatMap(node => node.declaration.declarations)
		.find(d => d.id.type == 'Identifier' && d.id.name == 'deferred');

	if(declarator)
	{
		if(declarator.init?.type != 'BooleanLiteral')
			throw new Error(`${file} must export deferred as the literal true or false`);
		return declarator.init.value;
	}

	// exported some other way, e.g. `export { deferred }` or `export let deferred`
	let otherwise = exported.some(node =>
		node.specifiers.some(s => (s.exported.name ?? s.exported.value) == 'deferred') ||
		node.declaration?.declarations?.some(d => d.id.name == 'deferred') ||
		node.declaration?.id?.name == 'deferred');
	if(otherwise)
		throw new Error(`${file} must export deferred as the literal true or false`);

	return false;
}

/**
 * Finds every handler in each `folder` under sourceDir (paths relative to sourceDir), by how it runs:
 * - vue: .vue files
 * - deferred: .js files with `export const deferred = true`
 * - inRequest: other .js files
 */
export async function findEventHandlers(sourceDir, { folder } = defaults.eventHandlers)
{
	let files = (await fs.promises.readdir(sourceDir, { recursive: true }))
		.filter(f => path.dirname(f).split(path.sep).includes(folder))
		.sort();

	let inRequest = [];
	let deferred = [];
	let vue = [];

	for(let file of files)
	{
		if(file.endsWith('.vue'))
		{
			vue.push(file);
			continue;
		}

		if(!file.endsWith('.js'))
			continue;

		let source = await fs.promises.readFile(path.join(sourceDir, file), 'utf8');
		if(isDeferred(file, source))
			deferred.push(file);
		else
			inRequest.push(file);
	}

	return { inRequest, deferred, vue };
}

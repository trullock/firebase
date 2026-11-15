import fs from 'node:fs';
import path from 'node:path';
import { defaults } from './config.js';

/**
 * Finds the scripts in every `folder` under sourceDir, by name: the path around the folder, joined with '-',
 * e.g. system/scripts/restore.js is system-restore
 * @returns {Object<string, string>} each script's path relative to sourceDir, by name
 */
export function findScripts(sourceDir, { folder } = defaults.scripts)
{
	let scripts = {};
	for(let file of fs.readdirSync(sourceDir, { recursive: true }).filter(f => f.endsWith('.js')).sort())
	{
		let segments = file.slice(0, -3).split(path.sep);
		let i = segments.slice(0, -1).indexOf(folder);
		if(i == -1)
			continue;

		let name = [...segments.slice(0, i), ...segments.slice(i + 1)].join('-');
		if(scripts[name])
			throw new Error(`${file} and ${scripts[name]} are both named ${name}`);
		scripts[name] = file;
	}
	return scripts;
}

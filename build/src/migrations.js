import fs from 'node:fs';
import path from 'node:path';
import { defaults } from './config.js';

const datePrefix = /^\d{4}-\d{2}-\d{2}-/;

/**
 * Finds the migrations in every `folder` under sourceDir, in the order they run: by file name, which must start with
 * the date it was written (YYYY-MM-DD-), then by path. Each is named like a script, by the path around the folder joined
 * with '-', e.g. academies/migrations/2026-11-19-backfill.js is academies-2026-11-19-backfill
 * @returns {{ name: string, file: string }[]} each migration's name and path relative to sourceDir
 */
export function findMigrations(sourceDir, { folder } = defaults.migrations)
{
	let migrations = [];
	for(let file of fs.readdirSync(sourceDir, { recursive: true }).filter(f => f.endsWith('.js')))
	{
		let segments = file.slice(0, -3).split(path.sep);
		let i = segments.slice(0, -1).indexOf(folder);
		if(i == -1)
			continue;

		let fileName = segments.at(-1);
		if(!datePrefix.test(fileName))
			throw new Error(`${file} must be named after the date it was written, e.g. 2026-01-31-${fileName}.js, as migrations run in that order`);

		let name = [...segments.slice(0, i), ...segments.slice(i + 1)].join('-');
		if(migrations.some(m => m.name == name))
			throw new Error(`${file} and ${migrations.find(m => m.name == name).file} are both named ${name}`);

		migrations.push({ name, file, fileName });
	}

	return migrations
		.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.file.localeCompare(b.file))
		.map(({ name, file }) => ({ name, file }));
}

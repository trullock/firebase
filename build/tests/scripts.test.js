import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findScripts } from '../src/scripts.js';

async function domainWith(...files)
{
	let dir = await fs.mkdtemp(path.join(os.tmpdir(), 'domain-'));
	for(let file of files)
	{
		await fs.mkdir(path.join(dir, path.dirname(file)), { recursive: true });
		await fs.writeFile(path.join(dir, file), 'export default async function() {}\n');
	}
	return dir;
}

describe('build/scripts', () => {
	test('names scripts by their area and path, ignoring files that are only named scripts', async () => {
		let dir = await domainWith('system/scripts/restore.js', 'users/scripts/fix/emails.js', 'system/querys/scripts.js');

		assert.deepStrictEqual(findScripts(dir), {
			'system-restore': path.join('system', 'scripts', 'restore.js'),
			'users-fix-emails': path.join('users', 'scripts', 'fix', 'emails.js')
		});
	});
});

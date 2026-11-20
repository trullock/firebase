import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findMigrations } from '../src/migrations.js';

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

describe('build/migrations', () => {
	test('lists migrations in the order they were written, whichever area they are in', async () => {
		let dir = await domainWith('users/migrations/2026-02-01-emails.js', 'academies/migrations/2026-01-31-areas.js', 'system/querys/migrations.js');

		assert.deepStrictEqual(findMigrations(dir), [
			{ name: 'academies-2026-01-31-areas', file: path.join('academies', 'migrations', '2026-01-31-areas.js') },
			{ name: 'users-2026-02-01-emails', file: path.join('users', 'migrations', '2026-02-01-emails.js') }
		]);
	});

	test('refuses a migration not named after its date', async () => {
		let dir = await domainWith('users/migrations/emails.js');

		assert.throws(() => findMigrations(dir), /must be named after the date it was written/);
	});
});

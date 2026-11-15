import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findEventHandlers } from '../src/eventHandlers.js';

const findDomainEventHandlers = dir => findEventHandlers(dir);

async function domainWithHandler(source)
{
	let dir = await fs.mkdtemp(path.join(os.tmpdir(), 'domain-'));
	await fs.mkdir(path.join(dir, 'area/eventHandlers/group'), { recursive: true });
	await fs.writeFile(path.join(dir, 'area/eventHandlers/group/someEvent.js'), source);
	return dir;
}

describe('build/eventHandlers', () => {
	test('refuses to start if deferred isn\'t the literal true or false', async () => {
		let dir = await domainWithHandler(`const yes = true;\nexport const deferred = yes;\nexport default async function() {}\n`);

		await assert.rejects(findDomainEventHandlers(dir), /must export deferred as the literal true or false/);
	});

	test('refuses to start if deferred is exported other than as a const, whatever a comment says', async () => {
		let dir = await domainWithHandler(`// export const deferred = true\nconst deferred = true;\nexport { deferred };\nexport default async function() {}\n`);

		await assert.rejects(findDomainEventHandlers(dir), /must export deferred as the literal true or false/);
	});

	test('reads deferred however its line is formatted', async () => {
		let dir = await domainWithHandler(`export const deferred =\n\ttrue; // retried\nexport default async function() {}\n`);

		let { deferred } = await findDomainEventHandlers(dir);

		assert.deepStrictEqual(deferred, [path.join('area', 'eventHandlers', 'group', 'someEvent.js')]);
	});
});

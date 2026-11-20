import { before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import firestore from './persistence/firestore.js';
import { configureFunctions, registerMigrations } from '../src/domainFunctions.js';
import { configureMigrations, listMigrations, runPendingMigrations } from '../src/migrations.js';

// what the migrations did, and which should fail, shared with the migration files written below
globalThis.migrationsRun = [];
globalThis.migrationsFailing = new Set();

const migration = name => `export default async function(ctx) {
	if(globalThis.migrationsFailing.has('${name}'))
		throw new Error('${name} broke');
	globalThis.migrationsRun.push({ name: '${name}', issuingUserId: ctx.issuingUserId });
}
`;

const names = ['areas-2026-01-01-first', 'areas-2026-01-02-second', 'users-2026-01-03-third'];
const ran = () => globalThis.migrationsRun.map(r => r.name);

before(async () => {
	let domainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'domain-'));
	let migrations = [];
	for(let name of names)
	{
		let [area, ...rest] = name.split('-');
		let file = path.join(area, 'migrations', rest.join('-') + '.js');
		await fs.mkdir(path.join(domainDir, path.dirname(file)), { recursive: true });
		await fs.writeFile(path.join(domainDir, file), migration(name));
		migrations.push({ name, file });
	}

	configureFunctions({ domainDir, projectId: 'test' });
	registerMigrations(migrations);
	configureMigrations({ firestore });
});

beforeEach(() => {
	firestore.reset();
	globalThis.migrationsRun.length = 0;
	globalThis.migrationsFailing.clear();
});

describe('migrations', () => {
	test('run in order, once each', async () => {
		assert.deepStrictEqual(await runPendingMigrations(), { ran: names });
		assert.deepStrictEqual(await runPendingMigrations(), { ran: [] });

		assert.deepStrictEqual(ran(), names);
		assert.strictEqual(globalThis.migrationsRun[0].issuingUserId, 'MIGRATION');
		assert.deepStrictEqual((await listMigrations()).map(m => m.status), ['succeeded', 'succeeded', 'succeeded']);
	});

	test('stop at one that fails, and carry on from it next time', async () => {
		globalThis.migrationsFailing.add(names[1]);

		await assert.rejects(runPendingMigrations(), /second broke/);

		assert.deepStrictEqual(ran(), [names[0]]);
		let [first, second, third] = await listMigrations();
		assert.strictEqual(first.status, 'succeeded');
		assert.deepStrictEqual([second.status, second.error], ['failed', `${names[1]} broke`]);
		assert.strictEqual(third.status, 'pending');

		globalThis.migrationsFailing.clear();
		assert.deepStrictEqual(await runPendingMigrations(), { ran: names.slice(1) });
	});

	test('don\'t run while another run is running one', async () => {
		await firestore.doc('Migration/_lock').set({ startedOn: new Date(), running: names[0] });

		assert.deepStrictEqual(await runPendingMigrations(), { ran: [], alreadyRunning: true });
		assert.strictEqual((await listMigrations())[0].status, 'running');
	});

	test('take over from a run that died', async () => {
		await firestore.doc('Migration/_lock').set({ startedOn: new Date(Date.now() - 61 * 60000), running: names[0] });

		assert.deepStrictEqual(await runPendingMigrations(), { ran: names });
	});
});

import './setup.js';
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import auth from './auth.js';
import functions from './functions.js';
import { configureTasks, queueTask, registerTask } from '../src/tasks.js';
import { command, configureTesting, reset, runDueTasks, travelDays, tryCommand } from './harness.js';

// stands in for callableFn('command'): runs the named handler with the caller's auth and data
const handlers = {};
const commands = { run: req => handlers[req.data.fn](req.auth, req.data.data) };
const tasks = { __endpoint: { taskQueueTrigger: { retryConfig: { maxAttempts: 3 } } } };

configureTasks({ functions, queue: 'tasks' });
configureTesting({ commands, queries: commands, tasks, auth, functions, mocks: [auth, functions] });

let attempts = 0;
registerTask('flaky', async ({ failures }) => {
	if(++attempts <= failures)
		throw new Error('Not yet');
});

beforeEach(() => {
	reset();
	attempts = 0;
});

describe('testing harness', () => {
	test('commands run as the signed in user, with their current claims', async () => {
		handlers.whoAmI = caller => ({ uid: caller?.uid, isAdmin: !!caller?.token.isAdmin });
		let { uid } = await auth.createUser({ email: 'a@example.com' });
		await auth.setCustomUserClaims(uid, { isAdmin: true });

		assert.deepStrictEqual(await command(uid, 'whoAmI', {}), { uid, isAdmin: true });
		assert.deepStrictEqual(await command(null, 'whoAmI', {}), { isAdmin: false });
	});

	test('a command that fails throws, unless tried', async () => {
		handlers.fails = () => ({ success: false, error: 'No' });

		assert.deepStrictEqual(await tryCommand(null, 'fails', {}), { success: false, error: 'No' });
		await assert.rejects(command(null, 'fails', {}), /Command fails failed: "No"/);
	});

	test('tasks a command queues run after it, retried as the task function allows', async () => {
		handlers.queues = async (caller, data) => { await queueTask('flaky', data); return {}; };

		await command(null, 'queues', { failures: 2 });
		assert.strictEqual(attempts, 3);

		attempts = 0;
		await assert.rejects(command(null, 'queues', { failures: 3 }), /Task handler flaky failed all 3 attempts/);
	});

	test('tasks queued for later wait until the clock reaches them', async () => {
		await queueTask('flaky', { failures: 0 }, new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

		await runDueTasks();
		assert.strictEqual(attempts, 0);

		travelDays(3);
		await runDueTasks();
		assert.strictEqual(attempts, 1);
	});

	test('reset returns to the real time', () => {
		travelDays(10);
		assert.ok(new Date().valueOf() - Date.now() < 1000 && Date.now() > performance.timeOrigin + 9 * 24 * 60 * 60 * 1000);

		reset();
		assert.ok(Math.abs(Date.now() - (performance.timeOrigin + performance.now())) < 1000);
	});
});

import './setup.js';
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { callableFn, configureFunctions } from '../src/domainFunctions.js';

configureFunctions({ domainDir: fileURLToPath(new URL('./domain', import.meta.url)), projectId: 'test' });

const callables = { command: callableFn('command'), query: callableFn('query') };
const run = (type, fn) => callables[type].run({ auth: null, data: { fn } });

const outside = new URL('./domain/outside.js', import.meta.url).href;

describe('callable function names', () => {
	beforeEach(() => {
		delete globalThis.importedOutside;
	});

	test('a name runs its file', async () => {
		assert.deepStrictEqual(await run('command', 'things-nested-echo'), { ran: 'command' });
		assert.deepStrictEqual(await run('query', 'things-echo'), { ran: 'query' });
	});

	for(let type of ['command', 'query'])
	{
		for(let fn of [
			'data:text/javascript,globalThis.importedOutside=true;export default function(){}//',
			' data:text/javascript,globalThis.importedOutside=true;export default function(){}//',
			'DATA:text/javascript,globalThis.importedOutside=true;export default function(){}//-x',
			`${outside}?`,
			`${outside}#-x`,
			'things-..-..-outside',
			'..-outside',
			'things-../../outside',
			'things-%2e%2e-%2e%2e-outside',
			'things-..\\..\\outside',
			'things-nested-echo\n',
			'node:fs',
			'things',
			['data:text/javascript,globalThis.importedOutside=true;export default function(){}//'],
			{ split: 'x' },
			1
		])
		{
			test(`a ${type} named ${JSON.stringify(fn)} is rejected, importing nothing`, async () => {
				let result = await run(type, fn);

				assert.deepStrictEqual(result, { success: false, error: `Invalid ${type} invokation` });
				assert.strictEqual(globalThis.importedOutside, undefined);
			});
		}
	}
});

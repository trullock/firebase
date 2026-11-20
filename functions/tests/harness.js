import { autoMapFromFirestore, autoMapToFirestore } from '@trullock/firebase-common';
import { createContext, registeredFunctions } from '../src/domainFunctions.js';
import { dispatchTask } from '../src/tasks.js';

/**
 * Drives an app built on @trullock/firebase-functions in tests: commands and queries through the real callables (so
 * authorization and validation apply), the tasks they queue, schedules, and a clock that can be moved.
 */

let config = null;

/**
 * Configures the harness. Call it once, before any test runs.
 * @param {object} opts
 * @param {object} opts.commands the commands callable, callableFn('command')
 * @param {object} opts.queries the queries callable, callableFn('query')
 * @param {object} opts.tasks the task function, taskFn(), whose retryConfig.maxAttempts a failing task is tried up to
 * @param {object} opts.auth the Auth mock (testing/auth), which signs users in
 * @param {object} opts.functions the Functions mock (testing/functions) tasks are queued with
 * @param {{ reset() }[]} opts.mocks every mock reset() clears, e.g. firestore, auth, storage and functions
 * @param {() => void} [opts.onReset] called by reset() after clearing the mocks, e.g. to set environment variables
 */
export function configureTesting(opts)
{
	config = opts;
}

function configured()
{
	if(!config)
		throw new Error('configureTesting has not been called');
	return config;
}

const RealDate = Date;
let travelledMs = 0;

class TravelledDate extends RealDate
{
	constructor(...args)
	{
		if(args.length == 0)
			super(RealDate.now() + travelledMs);
		else
			super(...args);
	}

	static now()
	{
		return RealDate.now() + travelledMs;
	}

	// so dates made before travelling are still Dates
	static [Symbol.hasInstance](value)
	{
		return value instanceof RealDate;
	}
}

/**
 * Moves the clock forward (or back) by days, e.g. to after a deadline. reset() returns to the real time
 */
export function travelDays(days)
{
	travelMinutes(days * 24 * 60);
}

/**
 * Moves the clock forward (or back) by minutes. reset() returns to the real time
 */
export function travelMinutes(minutes)
{
	travelledMs += minutes * 60 * 1000;
	globalThis.Date = TravelledDate;
}

/**
 * Returns to the real time and clears every mock. Call it in beforeEach
 */
export function reset()
{
	let { mocks, onReset } = configured();

	travelledMs = 0;
	globalThis.Date = RealDate;

	for(let mock of mocks)
		mock.reset();

	onReset?.();
}

async function invoke(callable, uid, fn, data)
{
	let { auth } = configured();

	// a fresh ID token per call, so it carries the user's current claims
	let token = uid ? await auth.verifyIdToken(await auth.createIdToken(uid)) : null;

	// serialised as the frontend sends it, with autoMapToFirestore
	let result = await callable.run({
		auth: token ? { uid, token } : null,
		data: { fn, data: autoMapToFirestore(data) }
	});

	await runDueTasks();

	return autoMapFromFirestore(result) || {};
}

/**
 * Runs a command as the given user (or anonymously, for a null uid) through the commands callable, then the tasks it
 * queued, and returns its result, including a failure
 */
export function tryCommand(uid, fn, data)
{
	return invoke(configured().commands, uid, fn, data);
}

/**
 * Like tryCommand, but throws if the command fails
 */
export async function command(uid, fn, data)
{
	let result = await tryCommand(uid, fn, data);
	if(result.success === false)
		throw new Error(`Command ${fn} failed: ${JSON.stringify(result.error ?? result)}`);
	return result;
}

/**
 * Runs a query as the given user through the queries callable, and returns its result
 */
export function query(uid, fn, data)
{
	return invoke(configured().queries, uid, fn, data);
}

/**
 * Runs a scheduled function, e.g. academies-activateEvents, as the scheduler does, then the tasks it queued.
 * Unlike the scheduler, its errors fail the test
 */
export async function runSchedule(name)
{
	let schedule = registeredFunctions.scheduled.find(s => s.path == name);
	if(!schedule)
		throw new Error(`No scheduled function named ${name}`);

	let { default: fn } = await import(schedule.filePath);
	await fn({}, createContext({ issuingUserId: 'SCHEDULER', fn: name }));
	await runDueTasks();
}

const isDue = ({ opts }) => !opts?.scheduleTime || opts.scheduleTime.valueOf() <= Date.now();

/**
 * Runs the queued tasks whose scheduled time the clock has reached, as Cloud Tasks would, including any they queue.
 * Commands and schedules run it themselves; call it after travelling. Failures are retried as the task function's
 * retryConfig allows, and a task that never succeeds fails the test.
 */
export async function runDueTasks()
{
	let { functions, tasks } = configured();
	let { maxAttempts } = tasks.__endpoint.taskQueueTrigger.retryConfig;

	let next;
	while((next = functions.queued.findIndex(isDue)) != -1)
	{
		let [{ data }] = functions.queued.splice(next, 1);
		for(let attempt = 1; ; attempt++)
		{
			try
			{
				await dispatchTask(data);
				break;
			}
			catch(e)
			{
				if(attempt >= maxAttempts)
					throw new Error(`Task handler ${data.handler} failed all ${maxAttempts} attempts`, { cause: e });
			}
		}
	}
}

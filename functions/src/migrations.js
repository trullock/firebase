import { createContext, registeredFunctions } from './domainFunctions.js';
import { queueTask, registerTask } from './tasks.js';
import { error, log } from './logging/logger.js';

const ALREADY_EXISTS = 6;

let config = null;

/**
 * Configures running the migrations registered with registerMigrations: each runs once, in order, in the task
 * runMigrations, which queueMigrations queues (e.g. after a deploy). The task function's retries apply.
 * @param {object} opts
 * @param {object} opts.firestore where each migration's outcome, and the lock stopping two runs overlapping, are kept
 * @param {string} [opts.collection] the collection they're kept in
 * @param {number} [opts.lockMinutes] how long one migration can run before another run may assume it died. At least
 * the task function's timeout
 */
export function configureMigrations(opts)
{
	config = { collection: 'Migration', lockMinutes: 60, ...opts };
	registerTask('runMigrations', () => runPendingMigrations());
}

function configured()
{
	if(!config)
		throw new Error('configureMigrations has not been called');
	return config;
}

const recordOf = name => configured().firestore.doc(`${configured().collection}/${name}`);
const lockDoc = () => configured().firestore.doc(`${configured().collection}/_lock`);
const millis = value => value?.toMillis?.() ?? value?.valueOf() ?? null;

async function heldLock()
{
	let held = (await lockDoc().get()).data();
	return held && Date.now() - millis(held.startedOn) < configured().lockMinutes * 60000 ? held : null;
}

async function claimLock()
{
	try
	{
		await lockDoc().create({ startedOn: new Date() });
		return true;
	}
	catch(e)
	{
		if(e.code != ALREADY_EXISTS)
			throw e;
	}

	if(await heldLock())
		return false;

	await lockDoc().set({ startedOn: new Date() });
	return true;
}

/**
 * Queues the task running the migrations that haven't succeeded yet
 */
export function queueMigrations()
{
	configured();
	return queueTask('runMigrations', {});
}

/**
 * Runs, in order, each registered migration that hasn't succeeded yet, recording each outcome. Stops at the first that
 * fails, rethrowing its error. Does nothing while another run holds the lock.
 * @returns {Promise<{ ran: string[], alreadyRunning?: boolean }>} the names of the migrations run
 */
export async function runPendingMigrations()
{
	if(!await claimLock())
	{
		log('Migrations are already running');
		return { ran: [], alreadyRunning: true };
	}

	let ran = [];
	try
	{
		for(let { name, filePath } of registeredFunctions.migrations)
		{
			if((await recordOf(name).get()).data()?.status == 'succeeded')
				continue;

			// renewed for each migration, so lockMinutes limits one migration rather than the whole run
			await lockDoc().set({ startedOn: new Date(), running: name });

			try
			{
				let module = await import(filePath);
				await module.default(createContext({ issuingUserId: 'MIGRATION', fn: name }));
			}
			catch(e)
			{
				error('Migration failed', { error: e, migration: name });
				await recordOf(name).set({ name, status: 'failed', ranOn: new Date(), error: e?.message ?? String(e) });
				throw e;
			}

			await recordOf(name).set({ name, status: 'succeeded', ranOn: new Date() });
			log(`Migration ${name} succeeded`);
			ran.push(name);
		}
	}
	finally
	{
		await lockDoc().delete();
	}

	return { ran };
}

/**
 * Each registered migration, in order, with its status: pending, running, succeeded or failed.
 * ranOn is when it last finished, in milliseconds, and error why it last failed.
 * @returns {Promise<{ name: string, status: string, ranOn: number|null, error: string|null }[]>}
 */
export async function listMigrations()
{
	let running = (await heldLock())?.running;

	return Promise.all(registeredFunctions.migrations.map(async ({ name }) => {
		let record = (await recordOf(name).get()).data();
		return {
			name,
			status: name == running ? 'running' : record?.status ?? 'pending',
			ranOn: millis(record?.ranOn),
			error: record?.status == 'failed' ? record.error : null
		};
	}));
}

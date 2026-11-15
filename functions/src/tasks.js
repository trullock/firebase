import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { autoMapFromFirestore, autoMapToFirestore } from '@trullock/firebase-common';
import { environment } from './utils.js';
import { error } from './logging/logger.js';
import { registerEventHandler } from './cqrs/eventHandling.js';

let config = null;
const handlers = new Map();

/**
 * Configures the tasks. Call it before queueing any.
 * @param {object} opts
 * @param {{ taskQueue(name) }} opts.functions the firebase-admin Functions client tasks are queued with
 * @param {string} opts.queue the task function every task is queued to, e.g. locations/europe-west2/functions/tasks,
 * which runs them with dispatchTask
 */
export function configureTasks(opts)
{
	config = opts;
}

function enqueue(handler, data, opts)
{
	if(!config)
		throw new Error('configureTasks has not been called');

	return config.functions.taskQueue(config.queue).enqueue(autoMapToFirestore({ handler, event: data }), opts);
}

// .js handlers default export async function(event)
async function runModule(handlerPath, event)
{
	let module = await import(pathToFileURL(handlerPath));
	await module.default(event);
}

/**
 * Registers each of files (relative to root) as a handler for the event it's named after (its name without its extension).
 * Instead of running during the request, the handler runs in a task, so it's retried on failure and isn't lost if the
 * request ends first. Handlers must throw on failure to be retried, and may run more than once.
 * run(handlerPath, event) runs a handler, e.g. to compile and send an email .vue, and defaults to importing a .js.
 */
export function registerTaskHandlers(root, files, run = runModule)
{
	for(let file of files)
	{
		let handler = file.split(path.sep).join('/');
		handlers.set(handler, { handlerPath: path.join(root, file), run });
		registerEventHandler(`Queue task handler ${handler}`, path.parse(file).name, event => enqueue(handler, event));
	}
}

/**
 * Registers run(data) as the task named name, queued with queueTask
 */
export function registerTask(name, run)
{
	handlers.set(name, { handlerPath: null, run: (handlerPath, data) => run(data) });
}

/**
 * Queues the task named name with data, to run straight away or at scheduleTime (a Date, or anything with toDate())
 */
export async function queueTask(name, data, scheduleTime)
{
	if(!scheduleTime)
		return enqueue(name, data);

	let when = scheduleTime.toDate?.() ?? scheduleTime;

	// the emulator runs tasks straight away, whatever their scheduleTime, and a task can't wait for it as the emulator
	// runs one function at a time when debugging, so in dev the task is queued at that time instead. If the functions
	// restart first it's lost.
	if(environment() == 'dev')
	{
		setTimeout(() => enqueue(name, data).catch(err => error('Error queueing task', { error: err, name, data })), when - Date.now() + 1000);
		return;
	}

	await enqueue(name, data, { scheduleTime: when });
}

/**
 * Runs the handler a dispatched task names, with its event. Only registered handlers can be run.
 */
export async function dispatchTask(data)
{
	let { handler, event } = autoMapFromFirestore(data);

	let registered = handlers.get(handler);
	if(!registered)
		throw new Error(`No task handler registered as ${handler}`);

	await registered.run(registered.handlerPath, event);
}

import { subscribe, publish, setErrorHandler, setLogger } from '@trullock/pubsub'
import { log, error } from '../logging/logger.js';
import fs from 'fs';
import path from 'path'

let allHandlers = []

/**
 * Registers a listener to domain events.
 * Will be executed synchronously but not in a defined order
 * @param {string} name The name of this handler, useful for logging and debugging
 * @param {string} type The event type this handler listens to
 * @param {function} handler event => void handler for this event
 */
export function registerEventHandler(name, type, handler)
{
	subscribe(type, handler, name)
}


let beforePublishHandlers = [];

/**
 * Registers a handler to be executed before publishing an event
 * @param {function} handler (type, event) => void
 */
export function beforePublish(handler)
{
	beforePublishHandlers.push(handler);
};

/**
 * Publishes a domain event
 * @param {string} type Event type
 * @param {object} event The event data
 */
export async function publishEvent(type, event)
{
	for(let i = 0; i < beforePublishHandlers.length; i++)
	{
		try
		{
			await Promise.resolve(beforePublishHandlers[i](type, event));
		}
		catch(e)
		{
			error(`Error executing beforePublish handler`, { error: e, handler: beforePublishHandlers[i], args: [type, event] });
		}
	}

	return publish(type, event);
}

setErrorHandler((e, handler, args) =>
{
	error('Error executing pubsub subscriber', { error: e, handler, args});
});

setLogger((message, args) =>
{
	log(message, args);
});

async function loadEventHandler(handlerPath, type)
{
	let module = await import(handlerPath)

	if(!module.default)
		return;

	// let blocking = module.blocking === true

	log(`Registering event handler for '${handlerPath}' and event type '${type}'`)
	// registerEventHandler(`${handlerPath}`, type, async e => {
	// 	let result = module.default(e);
	// 	// all handlers are unawaited by default
	// 	if(blocking)
	// 		await result;
	// 	else
	// 		result.catch(err => error('Error executing lazy event handler', { error: err, handlerPath, e}))
	// })

	registerEventHandler(`${handlerPath}`, type, module.default);
}

export function listAllHandlers()
{
	return [...allHandlers];
}

export async function registerEventHandlers(root, filter, lazy = true, loader = loadEventHandler)
{
	const p = path.resolve(root);
	const files = await fs.promises.readdir(p, { recursive: true });

	let lazyHandlers = { }
	let lazyEventHandlers = files.filter(filter)
	for(let handler of lazyEventHandlers)
	{
		let handlerPath = path.join(root, handler);
		let eventName = path.basename(handlerPath, '.js')

		if(lazy)
		{
			if(!lazyHandlers[eventName])
				lazyHandlers[eventName] = { loaded: false, handlers: [] };
			lazyHandlers[eventName].handlers.push(handlerPath)
		}
		else
		{
			await loader(handlerPath, eventName)
		}

		allHandlers.push({ handlerPath, eventName, lazy })
	}

	if(lazy)
	{
		beforePublish(async (type, event) => {
			if(!lazyHandlers[type])
				return;

			if(lazyHandlers[type].loaded)
				return;

			await Promise.all(lazyHandlers[type].handlers.map(async handlerPath => {
				await loader(handlerPath, type)
			}))

			lazyHandlers[type].loaded = true;
		})
	}
}

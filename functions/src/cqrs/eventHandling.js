import { subscribe, publish, setErrorHandler, setLogger } from '@trullock/pubsub'
import { log, debug, error } from '../logging/logger.js';

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
export function publishEvent(type, event)
{
	for(let i = 0; i < beforePublishHandlers.length; i++)
	{
		try
		{
			beforePublishHandlers[i](type, event);
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

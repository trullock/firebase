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

/**
 * Publishes a domain event
 * @param {string} type Event type
 * @param {object} event The event data
 */
export function publishEvent(type, event)
{
	debug(`Publishing event ${type}`, event)
	publish(type, event);
}

setErrorHandler((e, handler, args) =>
{
	error('Error executing pubsub subscriber');
	error(e);
	error(handler);
	error(args);
});

setLogger((message, args) =>
{
	log(message, args);
});

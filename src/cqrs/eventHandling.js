import { subscribe, publish } from '@trullock/pubsub'
import { setErrorHandler, setLogger } from '@trullock/pubsub'
import { log, debug, error } from '../logging/logger.js';


export function registerEventHandler(name, type, handler)
{
	subscribe(type, handler, name)
}

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

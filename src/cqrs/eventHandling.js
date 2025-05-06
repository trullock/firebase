import { subscribe, publish } from '@trullock/pubsub'
import { log } from './logger.js'
import { setErrorHandler, setLogger } from '@trullock/pubsub'


export function registerEventHandler(name, type, handler)
{
	subscribe(type, handler, name)
}

export function publishEvent(type, event)
{
	debug(`Publishing event ${type}`, event)
	publish(type, event);
}

setErrorHandler((error, handler, args) =>
{
	error('Error executing pubsub subscriber');
	error(error);
	error(handler);
	error(args);
});

setLogger((message, args) =>
{
	log(message, args);
});

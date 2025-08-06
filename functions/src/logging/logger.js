import { logger } from 'firebase-functions'
import { environment } from "../utils.js";

let errorHandler = (m, ...d) => {
	console.error(m, ...d,)
};
export function setErrorHandler(handler) {
	errorHandler = handler;
}
export function error(message, data)
{
	if(data)
	{
		for(let key of Object.keys(data))
		{
			if(data[key] instanceof Error)
			{
				data[key + '_Type'] = data[key].constructor.name;
				data[key + '_Name'] = data[key].name;
				data[key + '_Message'] = data[key].message;
				data[key + '_Stack'] = data[key].stack;
			}
		}
	}
	errorHandler(message, data);
}

let logHandler = (m, ...d) => console.log(m, ...d);
export function setLogHandler(handler) {
	logHandler = handler;
}
export function log(message, ...data)
{
	logHandler(message, ...data);
}

let warnHandler = (m, ...d) => console.warn(m, ...d);
export function setWarnHandler(handler) {
	warnHandler = handler;
}
export function warn(message, ...data)
{
	warnHandler(message, ...data);
}


let debugHandler = (m, ...d) => console.log(m, ...d);
export function setDebugHandler(handler) {
	debugHandler = handler;
}
export function debug(message, ...data)
{
	debugHandler(message, ...data);
}

if(environment() == 'prod')
{
	setErrorHandler((m, ...d) => logger.error(m, ...d))
	setWarnHandler((m, ...d) => logger.warn(m, ...d))
	setLogHandler((m, ...d) => logger.log(m, ...d))
	setDebugHandler((m, ...d) => logger.debug(m, ...d))
}
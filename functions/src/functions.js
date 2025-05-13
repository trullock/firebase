import { sep } from 'path';
import { loadModules } from './moduleLoader.js';
import { logger } from 'firebase-functions';
import { onCall as onCallRaw, onRequest as onRequestRaw } from 'firebase-functions/v2/https'

// Get the id of the function we are trying to execute
let runtimeFunctionId = (process.env.FUNCTION_NAME || process.env.K_SERVICE);
if(runtimeFunctionId)
{
	// trim the first part, this is the wrapper export name in your index.js
	const [prefix, ...rest] = runtimeFunctionId.split('-')
	runtimeFunctionId = rest.join('-');
}

const areDeploying = !runtimeFunctionId;
const funcNameMatchesInstance = funcName => funcName === runtimeFunctionId;

const set = (string, obj, value) => {
    const [current,...rest] = string.split(".");
    rest.length >= 1 ? set(rest.join("."), obj[current] = obj[current] || {}, value) : obj[current] = value;
    return obj; 
};

export async function exportFunctions({
	filter = /.*.js$/,
	getFunctionName = path => {
		// trim .js
		path = path.substring(0, path.length - 3)
		path = path.replaceAll(sep, '-');
		return path;
	},
	rootDir
}) 
{
	const exports = {};
	
	let modules = await loadModules({ filter, rootDir })

	if (!areDeploying)
		logger.time(`Searching for function '${runtimeFunctionId}'`);

	for (const file of Object.keys(modules))
	{
		logger.debug(`Processing ${file}`)

		const funcName = getFunctionName(file);

		if (!areDeploying && !funcNameMatchesInstance(funcName))
		{
			logger.debug(`Skipping ${file}, does not match ${funcName} / ${runtimeFunctionId}`)
			continue;
		}

		let funcTrigger = modules[file].default;
		
		if (!funcTrigger || typeof funcTrigger != 'function')
		{
			logger.warn(`Skipping ${funcName}, cant find default exported function`)
			continue;
		}

		if (!/^[a-z0-9z-]{1,62}$/i.test(funcName))
		{
			logger.error(`Skipping '${funcName}', not a valid firebase function name. Function names can only contain letters, numbers, hyphens, and not exceed 62 characters in length`)
			continue;
		}

		const objPath = funcName.replaceAll('-', '.')
		set(objPath, exports, funcTrigger);

		logger.debug(`Exporting ${funcName}`)
	}

	return exports;
}

export function onRequest(options, handler) {
	return onRequestRaw(options, async (request, response) => {
		if(request.body.warmUp === true)
		{
			response.sendStatus(201);
			return;
		}
				
		try
		{
		 	await Promise.resolve(handler(request, response));
		}
		catch(e)
		{
			error('Error invoking function', e, {
				query: request.query,
				body: request.body
			})
			response.sendStatus(500);
		}
	});
}

export function onCall(options, handler) {
	return onCallRaw(options, async (request) => {
		request.data = request.data || {};

		if(request.data.warmUp === true)
			return true;
		
		request.data = autoMapFromFirestore(request.data);
		
		try
		{
			let result = await Promise.resolve(handler(request));
			return autoMapToFirestore(result);
		}
		catch(e)
		{
			error('Error invoking function', e, {
				auth: request.auth,
				data: request.data
			})

			return { 
				success: false,
				error: 'An error occurred, please contact UKRA'
			}
		}
	});
}
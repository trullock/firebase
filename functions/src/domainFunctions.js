import { autoMapFromFirestore, autoMapToFirestore } from '@trullock/firebase-common'
import { onCall as onCallRaw, onRequest as onRequestRaw } from 'firebase-functions/v2/https'
import { setGlobalOptions } from "firebase-functions";
import { environment } from "./utils.js";
import { error, log } from "./logging/logger.js";
import { onSchedule } from "firebase-functions/scheduler";
import { onMessagePublished } from "firebase-functions/pubsub";
import { onTaskDispatched } from "firebase-functions/tasks";
import { ZodError } from "zod";
import Router from '@trullock/router'
import { pathToFileURL } from "node:url";

let config = {
	domainDir: null,
	projectId: null,
	now: () => new Date(),
	secrets: [],
	callable: {},
	api: {},
	unexpectedErrorMessage: 'An error occurred',
	emulatorPorts: { hosting: 5000, functions: 5001 },
	simulateColdStartMs: 0
};

/**
 * Configures the functions. Call it before defining any.
 * @param {object} opts
 * @param {string} opts.domainDir where commands, queries, schedules, subscribers, scripts and api routes are, by path relative to it
 * @param {string} opts.projectId
 * @param {object} [opts.globalOptions] firebase-functions' setGlobalOptions(), e.g. region and serviceAccount
 * @param {() => any} [opts.now] the clock contexts' occurredOn is read from
 * @param {Array} [opts.secrets] the secrets every function can read
 * @param {object} [opts.callable] onCall's options for commands and queries, overridden by callableFn()'s
 * @param {object} [opts.api] onRequest's options for apis, overridden by each api's
 * @param {string} [opts.unexpectedErrorMessage] what a command or query that fails unexpectedly returns
 * @param {{ hosting: number, functions: number }} [opts.emulatorPorts] for the api urls devtools lists
 * @param {number} [opts.simulateColdStartMs] delays commands and queries, to try the frontend with a slow start
 */
export function configureFunctions(opts)
{
	let { globalOptions, ...rest } = opts;
	config = { ...config, ...rest, region: globalOptions?.region, domainDir: pathToFileURL(opts.domainDir.replace(/\/?$/, '/')).href };

	if(!config.projectId)
		throw new Error('configureFunctions needs a projectId');

	if(globalOptions)
		setGlobalOptions(globalOptions);
}

function domainFile(relativePath)
{
	if(!config.domainDir)
		throw new Error('configureFunctions has not been called');

	return new URL(relativePath, config.domainDir).href;
}

export const registeredFunctions = {
	apis: [],
	scheduled: [],
	subscribers: [],
	scripts: [],
	migrations: []
}

// e.g. users-account-changeName is users/<type>/account/changeName.js
function getFilePath(type, name)
{
	let [area, ...rest] = name.split('-');
	return domainFile([area, type, ...rest].join('/') + '.js');
}

function withSecrets(opts)
{
	return { ...opts, secrets: [...new Set([...config.secrets, ...(opts.secrets ?? [])])] };
}

export function createContext(opts)
{
	let result = Object.assign({
		issuingUserId: 'ANON',
		occurredOn: config.now(),
		auth: null,
		fn: 'UNKNOWN'
	}, opts);

	return result;
}

export async function importFunction(path, ctx)
{
	let module = null;
	try
	{
		module = await import(path);
	}
	catch(e)
	{
		error('Error loading function module', { error: e, path, ctx})
		return null
	}

	if(typeof module.default != 'function')
	{
		error('Error loading function module', { error: e, path, ctx})
		return null
	}

	return module;
}

function buildFnTree(fns, type, cb)
{
	let result = {};

	for(let [path, opts] of Object.entries(fns))
	{
		let filePath = getFilePath(type, path)

		let currentResult = result;
		let pathSegments = path.split('-');
		for(let i = 0; i < pathSegments.length; i++)
		{
			if(i < pathSegments.length - 1)
			{
				if(!currentResult[pathSegments[i]])
					currentResult[pathSegments[i]] = {}
				currentResult = currentResult[pathSegments[i]]
			}
			else
			{
				cb(filePath, path, currentResult, pathSegments[i], opts)
			}
		}
	}
	
	return result;
}


function onCall(cb, opts) {
	return onCallRaw(withSecrets({ ...config.callable, ...opts }), async (request) => {
		request.data = request.data || {};

		async function exec(resolve)
		{
			//debug('Invoking function', request)
			if(request.data.warmUp === true)
			{
				resolve(true);
				return;
			}
			
			request.data = autoMapFromFirestore(request.data);
			
			try
			{
				let result = await Promise.resolve(cb(request));
				resolve(autoMapToFirestore(result));
			}
			catch(e)
			{
				error('Error invoking function', {
					error: e,
					fn: request.data.fn,
					auth: request.auth,
					data: request.data
				})

				resolve({ 
					success: false,
					error: config.unexpectedErrorMessage
				})
			}
		}

		let result = await new Promise(async (resolve) => {
			if(config.simulateColdStartMs)
				setTimeout(() => exec(resolve), config.simulateColdStartMs)
			else
				exec(resolve);
		});

		return result;
	});
}

////////////////////////////////////////////////////////////////////////////////

let authMechanisms = {};

export function registerAuthMechanism(name, callableMechanism, apiMechanism)
{
	authMechanisms[name] = {
		callableMechanism,
		apiMechanism
	}
}

////////////////////////////////////////////////////////////////////////////////


export function domainQuery(schema, handler)
{
	let fn = function(ctx, data)
	{
		if(schema)
		{
			let query = schema.strict().parse(data)
			return handler(ctx, query)
		}	
		
		return handler(ctx)
	}
	fn._type = 'domain-query';
	return fn;
}

export function domainCommand(schema, handler)
{
	let fn = function(ctx, data)
	{
		if(schema)
		{
			let command = schema.strict().parse(data)
			return handler(ctx, command)
		}

		return handler(ctx)
	}
	fn._type = 'domain-command';
	return fn;
}

/**
 * The callable running every command (type 'command') or query (type 'query'), named by req.data.fn, e.g.
 * users-account-changeName runs <domainDir>/users/commands/account/changeName.js. opts are onCall's.
 */
export function callableFn(type, opts)
{
	return onCall(async req => {
		let fn = req.data.fn;
		if(!fn)
			return { success: false, error: 'Invalid request, ' + type + ' path missing'};

		let filePath = getFilePath(type + 's', fn)

		let module = await importFunction(filePath, { auth: req.auth, data: req.data.data, fn });
		if(module?.default?._type == 'domain-' + type)
		{
			try
			{
				let ctx = createContext({ issuingUserId: req.auth?.uid || 'ANON', auth: req.auth, fn });
				
				// inline authorization: `export const authorize = async (ctx, data) => boolean`
				// runs before schema validation, so treat `data` as untrusted
				if(typeof module.authorize == 'function')
				{
					if(!ctx.auth)
						return { success: false, error: 401 };

					let allowed = await Promise.resolve(module.authorize(ctx, req.data.data || {}));
					if(allowed !== true)
						return { success: false, error: 403 };

					return await module.default(ctx, req.data.data)
				}

				if(typeof module.authorize == 'string')
				{
					let mechanism = authMechanisms[module.authorize];
					if(!mechanism || !mechanism.callableMechanism)
						throw new Error(`Invalid auth mechanism '${module.authorize}'. Did you call registerAuthMechanism('${module.authorize}', (fn, auth, ctx, command, data) => { ... }, ...); ?`)

					return await mechanism.callableMechanism(ctx, module.default, req.data.data)
				}

				return await module.default(ctx, req.data.data)
			}
			catch(e)
			{
				if(e instanceof ZodError)
				{
					error("Validation error executing " + type, {
						fn,
						issues: e.issues
					})
					
					return { 
						success: false, 
						error: {
							type: 'validation',
							issues: e.issues
						}
					}
				}
				else
				{
					error("Error executing " + type, {
						fn,
						module,
						e
					})
					return { success: false, error: e.message || 'Error executing ' + type };
				}
			}
		}

		error("Invalid " + type + " invokation", fn, module)

		return { success: false, error: 'Invalid ' + type + ' invokation'};
	}, opts)
}

////////////////////////////////////////////////////////////////////////////////

function onRequest(cb, opts) {
	return onRequestRaw(withSecrets({ ...config.api, ...opts }), async (request, response) => {
		if(request.body.warmUp === true)
		{
			response.sendStatus(201);
			return;
		}
				
		try
		{
		 	await Promise.resolve(cb(request, response));
			response.end();
		}
		catch(e)
		{
			error('Error invoking function', {
				error: e,
				query: request.query,
				body: request.body
			})
			response.sendStatus(500);
		}
	});
}

export function api(handler)
{
	let fn = function(...args)
	{
		return handler(...args)
	}
	fn._type = 'api';
	return fn;
}

function traverseApiDefinitions(fns, callback)
{
	let result = {};

	for(let [key, value] of Object.entries(fns))
	{
		
		let routes = value.routes || value.path
		let rewritePrefix = value.rewritePrefix || key;

		let opts = {};
		Object.assign(opts, value);
		delete opts.routes
		delete opts.path;
		delete opts.rewritePrefix;

		let fn = callback(rewritePrefix, routes, opts)
		if(fn)
			result[key] = fn;
	}
	
	return result;
}

/**
 * HTTP functions, by name: each either { path } for one handler, or { routes: { route: path }, rewritePrefix } routed by
 * @trullock/router, paths relative to domainDir. Other options are onRequest's, plus environment: 'dev' to only define it in the emulator.
 */
export function apiFns(apiFns)
{
	async function executeModule(filePath, req, res)
	{
		try
		{
			let module = await importFunction(domainFile(filePath), {});
			if(module?.default?._type != 'api')
			{
				error("Invalid API definition", {
					filePath,
					params: req.params,
					module
				})

				res.send(500);
				return;
			}

			if(module.authorize)
			{
				let mechanism = authMechanisms[module.authorize];
				if(!mechanism || !mechanism.apiMechanism)
					throw new Error(`Invalid auth mechanism '${module.authorize}'. Did you call registerAuthMechanism('${module.authorize}', ..., (api, req, res) => { ... }); ?`)

				await Promise.resolve(mechanism.apiMechanism(module.default, req, res))
				return;
			}
			
			await Promise.resolve(module.default(req, res))
		}
		catch(e)
		{
			error('Error executing API', { error: e, filePath})
			res.send(500);
		}
	}

	return traverseApiDefinitions(apiFns, (prefix, routesOrPath, opts) => {

		if(opts.environment == 'dev' && environment() != 'dev')
			return null;
		delete opts.environment;

		let emulatedFunctions = `http://localhost:${config.emulatorPorts.functions}/${config.projectId}/${opts.region ?? config.region}/apis-`;

		if(typeof routesOrPath == 'string')
		{
			registeredFunctions.apis.push({ url: emulatedFunctions + prefix, filePath: routesOrPath })
			
			return onRequest(async (req, res) => {
				await executeModule(routesOrPath, req, res)
			}, opts)
		}
		else 
		{
			let router = new Router();
			for(let [route, filePath] of Object.entries(routesOrPath))
			{
				let url = ''
				if(prefix)
					url = `http://localhost:${config.emulatorPorts.hosting}` + prefix + route
				else
					url = emulatedFunctions + route.replace(/^\//, '')

				router.addRoute(route, prefix + route, { filePath })
				registeredFunctions.apis.push({ url, filePath })
			}

			return onRequest(async (req, res) => {

				let result = router.parse(req.path)
				if(!result)
				{
					// diabolical hack (that works on dev at least) to allow calling functions directly and not via hosting proxy
					if(!req.headers["x-forwarded-host"] && prefix)
						result = router.parse(prefix + req.path);

					if(!result)
					{
						res.send(404);
						return;
					}
				}

				req.params = result.params;
				await executeModule(result.data.filePath, req, res)
			}, opts)
		}
	})
}
////////////////////////////////////////////////////////////////////////////////



/**
 * Scheduled functions, by name, e.g. academies-activateEvents runs <domainDir>/academies/schedules/activateEvents.js.
 * Options are onSchedule's.
 */
export function scheduledFns(fns)
{
	return buildFnTree(fns, 'schedules', (filePath, path, dest, pathSegment, opts) => {
		dest[pathSegment] = onSchedule(withSecrets(opts), async (event) => {
			try
			{
				let module = await importFunction(filePath, {});
				await Promise.resolve(module.default(event, createContext({ issuingUserId: 'SCHEDULER', fn: path })));
			}
			catch(e)
			{
				error('Error invoking scheduled function', {
					error: e,
					errorType: e?.constructor?.name,
					event: event
				})
			}
		})

		registeredFunctions.scheduled.push({ path, filePath })
	})
}

////////////////////////////////////////////////////////////////////////////////


/**
 * Pub/Sub subscribers, by name, e.g. system-billing runs <domainDir>/system/subscribers/billing.js.
 * Options are onMessagePublished's, including its topic.
 */
export function subscriberFns(fns)
{
	let result = buildFnTree(fns, 'subscribers', (filePath, path, dest, pathSegment, opts) => {
		dest[pathSegment] = onMessagePublished(withSecrets(opts), async (event) => {
			try
			{
				let module = await importFunction(filePath, {});
				await Promise.resolve(module.default(event));
			}
			catch(e)
			{
				error('Error invoking pubsub subscriber', {
					error: e,
					event: event
				})
				throw e;
			}
		})

		registeredFunctions.subscribers.push({ path, filePath, topic: opts.topic})
	});

	return result;
}



////////////////////////////////////////////////////////////////////////////////


/**
 * A Cloud Tasks function, running run(data) for each task. opts are onTaskDispatched's, e.g. retryConfig and rateLimits.
 */
export function taskFn(opts, run)
{
	return onTaskDispatched(withSecrets(opts), async (req) => {
		try
		{
			await run(req.data);
		}
		catch(e)
		{
			error('Error running task', {
				error: e,
				data: req.data,
				retryCount: req.retryCount
			})
			// rethrow so Cloud Tasks retries, as configured by retryConfig
			throw e;
		}
	})
}

////////////////////////////////////////////////////////////////////////////////


/**
 * Registers scripts to run with runScript(), as { name: path relative to domainDir }.
 * A script default exports `async function(ctx)`.
 */
export function registerScripts(scripts)
{
	for(let [name, file] of Object.entries(scripts))
		registeredFunctions.scripts.push({ name, filePath: domainFile(file) });
}

export async function runScript(name, ctx)
{
	let script = registeredFunctions.scripts.find(s => s.name == name);
	if(!script)
		throw new Error(`No script named ${name}`);

	let module = await import(script.filePath);
	return await module.default(ctx);
}

/**
 * Registers migrations, run once each by runPendingMigrations (see migrations.js), as [{ name, file }] in the order they
 * run, by path relative to domainDir. A migration default exports `async function(ctx)`, and must be safe to run again,
 * as a run can end before recording that it succeeded.
 */
export function registerMigrations(migrations)
{
	for(let { name, file } of migrations)
		registeredFunctions.migrations.push({ name, filePath: domainFile(file) });
}
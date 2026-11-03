import { log, error, registerEventHandler } from '@trullock/firebase-functions'
import { renderVueEmail, sendEmail } from './emailUtils.js';

export async function loadEmailEventHandler(handlerPath, type)
{
	let module = await import(handlerPath)

	if(!module.default)
		return;

	log(`Registering event handler for '${handlerPath}' and event type '${type}'`)
	registerEventHandler(`${handlerPath}`, type, async e => {
		let results = module.default(e);
		if(!Array.isArray(results))
			results = [results];

		for(let result of results)
		{
			// all email handlers are unawaited
			renderVueEmail(module.ssrRender, result)
				.then(rendered => sendEmail(rendered.html, rendered.text, result.to, result.subject, result.source, result.tags, result.replyTos))
				.catch(err => error('Error executing lazy event handler', { error: err, handlerPath, e, result}))
		}

	})
}
import { log, error, registerEventHandler } from '@trullock/firebase-functions'
import { renderVueEmail, sendEmail } from './emailUtils.js';

export async function loadEmailEventHandler(handlerPath, type)
{
	let emailModule = await import(handlerPath)

	log(`Registering event handler for '${handlerPath}' and event type '${type}'`)
	registerEventHandler(`${handlerPath}`, type, async e => {
		let results = await emailModule.default(e);

		// its legitimte to return null, this means dont handle the event/send any emails
		if(results == null)
			return;

		if(!Array.isArray(results))
			results = [results];

		for(let result of results)
		{
			// all email handlers are unawaited
			renderVueEmail(emailModule.ssrRender, result)
				.then(rendered => sendEmail(rendered.html, rendered.text, result.to, result.subject, result.source, result.tags, result.replyTos))
				.catch(err => error('Error executing lazy event handler', { error: err, handlerPath, e, result}))
		}

	})
}
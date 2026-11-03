import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { compileEmail } from "../src/compiler.js";
import { publishEvent, registerEventHandlers, registerEventHandler  } from '@trullock/firebase-functions'
import  {setErrorHandler } from '@trullock/pubsub'
import { renderVueEmail } from "../src/emailUtils.js";

let wrapperPath = '';

async function loadEmailEventHandler(handlerPath, type)
{
	let bodyModule = await import(handlerPath)
	let wrapperModule = await import(wrapperPath)

	registerEventHandler(`${handlerPath}`, type, async e => {
		let results = await bodyModule.default(e);
		if(!Array.isArray(results))
			results = [results];

		for(let result of results)
		{
			let outcome = await renderVueEmail(wrapperModule, bodyModule.ssrRender, result)
			assert.equal(result.subject, 'i am the subject 2')
		}
	})
}

test('render', async t => {

	setErrorHandler(e => { 
		throw e 
	})
	wrapperPath = await compileEmail(path.resolve('./tests/wrapper.vue'), path.resolve('./obj'))

	await compileEmail(path.resolve('./tests/example.vue'), path.resolve('./obj'))

	await registerEventHandlers(path.resolve('./obj'), x => x, false, loadEmailEventHandler)

	publishEvent('example', { age: 18 })
})

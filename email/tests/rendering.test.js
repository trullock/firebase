import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { compileEmail } from "../src/compiler.js";
import { publishEvent, registerEventHandlers, registerEventHandler, log, error } from '@trullock/firebase-functions'

async function loadEmailEventHandler(handlerPath, type)
{
	let module = await import(handlerPath)

	let result = await renderVueEmail(module.ssrRender, result)

	assert.equal(result.subject, 'i am the subject 2')
}

test('render', async t => {

	await compileEmail(path.resolve('./tests/example.vue'), path.resolve('./obj'))

	registerEventHandlers(path.resolve('./obj'), x => x, true, loadEmailEventHandler)

	publishEvent('example', { age: 18 })
})
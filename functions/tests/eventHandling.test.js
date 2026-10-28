import test from "node:test";
import assert from "node:assert";
import { beforePublish, publishEvent } from "../src/cqrs/eventHandling.js";


test('beforePublish', t => {
	
	let executed = 0;
	beforePublish((type, event) => {
		executed += type == 'test-event' ? 1 : 0;
	});
	
	publishEvent('test-event', { foo: 'bar' });	
	publishEvent('wrong-event', { foo: 'bar' });

	assert.equal(executed, 1);
})
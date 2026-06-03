import test from "node:test";
import assert from "node:assert";
import { autoMapFromFirestore, autoMapToFirestore, registerClassForPersistence } from "../src/automapper.js";
import { Mixins } from "../src/utils.js";

class AggregateRoot
{
	_uncomittedEvents = []

	get isDirty() {
		return this._uncomittedEvents.length > 0;
	}

	
	/**
	 * Applys a new domain event to this object
	 * @param {string} eventType The type of the event
	 * @param {object} data The event data
	 */
	apply(eventType, data) 
	{
		data = data || {}
		if(!data.aggregateRootId)
			data.aggregateRootId = this.id;


		this._uncomittedEvents.push({
			type: eventType,
			sequence: ++this._lastEventSequence,
			data
		});
		
		this._applyEvent(eventType, data);
	}

	_applyEvent(eventType, data)
	{
		let handlerName = 'on' + eventType.substr(0, 1).toUpperCase() + eventType.substr(1);
		let fn = this[handlerName];
		if(fn)
			fn.call(this, data);
	}
}

class Foo {
    b = 2
    bar = new Foo.Bar();
	
	static Bar = class {
        a = 1
		
		barzy() {
			return "barzy"
		}
    }

	foozzy() {
		return "foozzy"
	}
}

class Baz extends Foo {
    static c = 3
	d = 4

	bazzy() {
		return "bazzy"
	}
}

class Academy extends Mixins([Baz, AggregateRoot])
{
	changeName(name)
	{
		this.apply('academyNameChanged', {
			name
		})
	}

	onAcademyNameChanged(event)
	{
		this.name = event.name;
	}

	constructor()
	{
		super();
		this.bar = new Baz.Bar();
	}

	static Test = class {}
}

test('test', t => {
	let a = new Academy();

	assert.equal(a.isDirty, false)

	a.changeName('name');

	assert.equal(a.isDirty, true)

	assert.equal(a.name, 'name')
})


test('automapping', t => {
	registerClassForPersistence(Academy);

	let a = new Academy();
	let mapped = autoMapToFirestore(a);
	let unmapped = autoMapFromFirestore(mapped);

	assert.equal(a.d, 4)
	assert.equal(mapped.d, 4)
	assert.equal(unmapped.d, 4)

	assert.equal(a.bar.a, 1)
	assert.equal(mapped.bar.a, 1)
	assert.equal(unmapped.bar.a, 1)

	assert.equal(a.bar.barzy(), "barzy")
	assert.equal(unmapped.bar.barzy(), "barzy")

	assert.equal(a.foozzy(), "foozzy")
	assert.equal(unmapped.foozzy(), "foozzy")

	assert.equal(a.bazzy(), "bazzy")
	assert.equal(unmapped.bazzy(), "bazzy")
})
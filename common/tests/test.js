import test from "node:test";
import assert from "node:assert";

function Mixins(bases) {
	class Bases {
		constructor() {
			bases.forEach(base => Object.assign(this, new base()));
		}
	}
	bases.forEach(base => {
		Object.getOwnPropertyNames(base.prototype)
			.filter(prop => prop != 'constructor')
			.forEach(prop => {
				//debugger
				let descriptor = Object.getOwnPropertyDescriptor(base.prototype, prop);
				Object.defineProperty(Bases.prototype, prop, descriptor)
				//Bases.prototype[prop] = base.prototype[prop]
			})
	})
	return Bases;
}

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



class Academy extends Mixins([AggregateRoot])
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
}

test('test', t => {
	let a = new Academy();

	assert.equal(a.isDirty, false)

	a.changeName('name');

	assert.equal(a.isDirty, true)

	assert.equal(a.name, 'name')
})

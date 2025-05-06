import { v4 as newId } from "uuid";
import DateTime from "../lib/dateTime.js";

export default class AggregateRoot
{
	id = ''
	#uncomittedEvents = []
	lastEventSequence = -1

	constructor()
	{
		this.id = newId();
	}

	get isDirty() {
		return this.#uncomittedEvents.length > 0;
	}

	apply(eventType, data) 
	{
		data = data || {}
		if(!data.aggregateRootId)
			data.aggregateRootId = this.id;

		if(!data.occurredOn)
			data.occurredOn = DateTime.now;

		this.#uncomittedEvents.push({
			type: eventType,
			sequence: ++this.lastEventSequence,
			data
		});
		
		this.#applyEvent(eventType, data);
	}

	#applyEvent(eventType, data)
	{
		let handlerName = 'on' + eventType.substr(0, 1).toUpperCase() + eventType.substr(1);
		let fn = this[handlerName];
		if(fn)
			fn.call(this, data);
	}

	commitEvents()
	{
		let events = this.#uncomittedEvents;
		this.#uncomittedEvents = [];
		return events;
	}
}
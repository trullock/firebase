export default class AggregateRoot
{
	id = ''
	_uncomittedEvents = []
	_ctx = null;
	_lastEventSequence = -1

	/**
	 * Does the entity have uncommitted events
	 */
	get isDirty() {
		return this._uncomittedEvents.length > 0;
	}

	/**
	 * Applys a new domain event to this object
	 * @param {string} eventType The type of the event
	 * @param {object} data The event data
	 * @param {CommandContext} ctx Domain Context object
	 */
	apply(eventType, data, ctx) 
	{
		data = data || {}
		if(!data.aggregateRootId)
			data.aggregateRootId = this.id;

		ctx = ctx || this._ctx

		if(!ctx)
			throw new Error('`ctx` is required')

		// Occurred On
		if(data.occurredOn)
			throw new Error('Event data cannot contain `occurredOn`, this is automatically set from the `ctx` object.')
		if(!ctx.occurredOn)
			throw new Error('`ctx` must contain a value for occurredOn')
		data.occurredOn = ctx.occurredOn;

		// Issuing User Id
		if(data.issuingUserId)
			throw new Error('Event data cannot contain `issuingUserId`, this is automatically set from the `ctx` object.')
		if(!ctx.issuingUserId)
			throw new Error('`ctx` must contain a value for issuingUserId')
		data.issuingUserId = ctx.issuingUserId;

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

	/**
	 * Clears the uncommitted events queue
	 * @returns The comitted events
	 */
	commitEvents()
	{
		let events = this._uncomittedEvents;
		this._uncomittedEvents = [];
		return events;
	}

	/**
	 * Sets the context for this unit of work
	 * @param {object} ctx Context object
	 */
	setContext(ctx)
	{
		this._ctx = ctx;
	}
}
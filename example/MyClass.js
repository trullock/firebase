export default class MyClass
{
	id = null
	// nombre = null; // Migrated to .name
	name = null
	createdOn = null

	static create(ctx, id, name)
	{
		const myClass = new MyClass();
		myClass.#create(ctx, id, name);
		return myClass;
	}

	#create(ctx, id, name)
	{
		this.apply('myClassCreated', {
			// aggregateRootId gets sets for all events automatically except on creation, as we dont have an id yet, so set it manually
			aggregateRootId: id,
			// everything else is domain specific info...
			name
		}, ctx)
	}

	onMyClassCreated(event)
	{
		this.aggregateRootId = event.aggregateRootId
		this.name = event.name;
		this.createdOn = event.occurredOn
	}
}
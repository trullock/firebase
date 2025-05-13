export default class MyClass
{
	id = null
	// nombre = null; // Migrated to .name
	name = null
	createdOn = null

	static create(issuingUserId, id, name, createdOn)
	{
		const myClass = new MyClass();
		myClass.#create(issuingUserId, id, name, createdOn);
		return myClass;
	}

	#create(issuingUserId, id, name, createdOn)
	{
		this.apply('myClassCreated', {
			// aggregateRootId gets sets for all events automatically except on creation, as we dont have an id yet, so set it manually
			aggregateRootId: id,
			// occurredOn is automatically set if not manually provided
			occurredOn: createdOn,
			// everything else is domain specific info...
			issuingUserId,
			name
		})
	}

	onMyClassCreated(event)
	{
		this.aggregateRootId = event.aggregateRootId
		this.name = event.name;
		this.createdOn = event.occurredOn
	}
}
class FirestoreMock 
{
	doc = function(path)
	{
		return new DocumentMock(this, path);
	}

	batch = function()
	{
		return new BatchMock(this);
	}
}

class DocumentMock
{
	#firestore = null;
	path = null;

	constructor(firestore, path)
	{
		this.#firestore = firestore;
		this.path = path;
	}

	delete()
	{
	}

	deleteRecursive()
	{
	}

	get()
	{

	}

	set()
	{
		
	}
}

class DocSnapshotMock
{
	#data = null;
	constructor(data)
	{
		this.#data = data;
	}

	get exists()
	{
		return this.#data !== null;
	}

	data()
	{
		return this.#data;
	}
}

class CollectionSnapshotMock
{
	#docs = [];

	constructor(docs)
	{
		this.#docs = docs;
	}

	get docs()
	{
		return this.#docs;
	}
}

class BatchMock
{
	#firestore = null;

	constructor(firestore)
	{
		this.#firestore = firestore;
	}

	create(doc, data)
	{

	}

	commit()
	{
	}
}

class CollectionMock 
{
	#firestore = null;
	#where = null;

	constructor(firestore, where)
	{
		this.#firestore = firestore;
		this.#where = where || (x => x);
	}

	get()
	{
		// TODO: get from firebase
		return new CollectionSnapshotMock([]);
	}

	where(predicate)
	{
		return new CollectionMock(this.#firestore, x => this.#where(x) && predicate(x));
	}
}

const fs = new FirestoreMock();
export default fs;
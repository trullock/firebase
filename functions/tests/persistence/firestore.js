import { GeoPoint, Timestamp } from 'firebase-admin/firestore';

const ALREADY_EXISTS = 6;

function isPlainObject(value)
{
	if(value === null || typeof value !== 'object')
		return false;

	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Deep copies a value the way Firestore would store it, so nothing shares references with the
 * caller. Rejects the same values the real SDK does, so tests catch data production would refuse.
 */
function toFirestoreValue(value, field = '', inArray = false)
{
	const location = field ? ` (found in field "${field}")` : '';

	if(value === undefined)
		throw new Error(`Cannot use "undefined" as a Firestore value${location}.`);

	if(value === null || ['boolean', 'number', 'string'].includes(typeof value))
		return value;

	if(value instanceof Date)
		return Timestamp.fromDate(value);

	if(value instanceof Timestamp || value instanceof GeoPoint)
		return value;

	if(value instanceof Uint8Array)
		return Buffer.from(value);

	if(Array.isArray(value))
	{
		if(inArray)
			throw new Error(`Cannot use nested arrays as a Firestore value${location}.`);

		return value.map((v, i) => toFirestoreValue(v, `${field}.${i}`, true));
	}

	if(isPlainObject(value))
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestoreValue(v, field ? `${field}.${k}` : k)]));

	throw new Error(`Couldn't serialize object of type "${value?.constructor?.name ?? typeof value}"${location}. Firestore doesn't support JavaScript objects with custom prototypes.`);
}

function toDocumentData(data)
{
	if(!isPlainObject(data))
		throw new Error('Value for argument "data" is not a valid Firestore document. Input is not a plain JavaScript object.');

	return toFirestoreValue(data);
}

function normalisePath(path, kind)
{
	if(typeof path !== 'string' || path === '')
		throw new Error(`Value for argument "${kind}Path" is not a valid resource path. Path must be a non-empty string.`);

	if(path.includes('//'))
		throw new Error(`Value for argument "${kind}Path" is not a valid resource path. Paths must not contain //.`);

	const segments = path.split('/').filter(s => s.length > 0);

	const isDocument = segments.length % 2 === 0;
	if(isDocument !== (kind === 'document'))
		throw new Error(`Value for argument "${kind}Path" must point to a ${kind}, but was "${path}". Your path does not contain an ${isDocument ? 'odd' : 'even'} number of components.`);

	return segments.join('/');
}

function isEqual(a, b)
{
	if(a === b || (Number.isNaN(a) && Number.isNaN(b)))
		return true;

	if(a instanceof Timestamp || a instanceof GeoPoint)
		return a.isEqual(b);

	if(a instanceof Uint8Array && b instanceof Uint8Array)
		return Buffer.compare(a, b) === 0;

	if(Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((v, i) => isEqual(v, b[i]));

	if(isPlainObject(a) && isPlainObject(b))
	{
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length
			&& keys.every(k => Object.hasOwn(b, k) && isEqual(a[k], b[k]));
	}

	return false;
}

/**
 * Orders two values, or returns NaN if they aren't comparable. Firestore range filters only match
 * values of the same type as the operand, and every comparison against NaN is false.
 */
function compare(a, b)
{
	if(a instanceof Timestamp && b instanceof Timestamp)
		return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;

	if(typeof a !== typeof b || !['boolean', 'number', 'string'].includes(typeof a))
		return NaN;

	if(a === b)
		return 0;

	return a < b ? -1 : a > b ? 1 : NaN;
}

// A missing field never reaches these: it matches no filter at all. Firestore also excludes null from != and not-in.
const operators = {
	'==': isEqual,
	'!=': (a, b) => a !== null && !isEqual(a, b),
	'<': (a, b) => compare(a, b) < 0,
	'<=': (a, b) => compare(a, b) <= 0,
	'>': (a, b) => compare(a, b) > 0,
	'>=': (a, b) => compare(a, b) >= 0,
	'array-contains': (a, b) => Array.isArray(a) && a.some(v => isEqual(v, b)),
	'array-contains-any': (a, b) => Array.isArray(a) && a.some(v => b.some(o => isEqual(v, o))),
	'in': (a, b) => b.some(o => isEqual(a, o)),
	'not-in': (a, b) => a !== null && !b.some(o => o === null || isEqual(a, o))
};

const listOperators = ['in', 'not-in', 'array-contains-any'];

function getField(data, fieldPath)
{
	let value = data;
	for(const key of fieldPath.split('.'))
	{
		if(!isPlainObject(value) || !Object.hasOwn(value, key))
			return undefined;

		value = value[key];
	}
	return value;
}

function createFilter(fieldPath, op, value)
{
	if(typeof fieldPath !== 'string')
		throw new Error('FirestoreMock only supports string field paths in where().');

	if(!Object.hasOwn(operators, op))
		throw new Error(`Value for argument "opStr" is invalid. Acceptable values are: ${Object.keys(operators).join(', ')}`);

	if((value === null || Number.isNaN(value)) && op !== '==' && op !== '!=')
		throw new Error(`Invalid query. You can only perform '==' and '!=' comparisons on ${value === null ? 'Null' : 'NaN'}.`);

	let operand;
	if(listOperators.includes(op))
	{
		if(!Array.isArray(value) || value.length === 0)
			throw new Error(`Invalid Query. A non-empty array is required for '${op}' filters.`);

		operand = value.map(v => toFirestoreValue(v));
	}
	else
	{
		operand = toFirestoreValue(value);
	}

	return data => {
		const field = getField(data, fieldPath);
		return field !== undefined && operators[op](field, operand);
	};
}

class FirestoreMock 
{
	_docs = new Map();

	doc = function(path)
	{
		return new DocumentMock(this, normalisePath(path, 'document'));
	}

	collection = function(path)
	{
		return new CollectionMock(this, normalisePath(path, 'collection'));
	}

	batch = function()
	{
		return new BatchMock(this);
	}

	recursiveDelete = async function(ref)
	{
		if(!(ref instanceof DocumentMock || ref instanceof CollectionMock))
			throw new Error('Value for argument "ref" must be a DocumentReference or CollectionReference.');

		const prefix = `${ref.path}/`;

		this._docs.delete(ref.path);
		for(const path of [...this._docs.keys()])
			if(path.startsWith(prefix))
				this._docs.delete(path);
	}

	/**
	 * Not part of Firestore. Clears all data, as the exported instance is shared between tests.
	 */
	reset = function()
	{
		this._docs = new Map();
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

	get id()
	{
		return this.path.split('/').pop();
	}

	delete()
	{
		return this.#commitSingle(batch => batch.delete(this));
	}

	async get()
	{
		return new DocSnapshotMock(this, this.#firestore._docs.get(this.path) ?? null);
	}

	set(data, options)
	{
		return this.#commitSingle(batch => batch.set(this, data, options));
	}

	#commitSingle(write)
	{
		const batch = new BatchMock(this.#firestore);
		write(batch);
		return batch.commit().then(results => results[0]);
	}
}

class DocSnapshotMock
{
	#data = null;
	ref = null;

	constructor(ref, data)
	{
		this.ref = ref;
		this.#data = data;
	}

	get id()
	{
		return this.ref.id;
	}

	get exists()
	{
		return this.#data !== null;
	}

	data()
	{
		return this.exists ? toFirestoreValue(this.#data) : undefined;
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
	#writes = [];
	#committed = false;

	constructor(firestore)
	{
		this.#firestore = firestore;
	}

	create(doc, data)
	{
		this.#verifyNotCommitted();
		const value = toDocumentData(data);

		this.#writes.push(docs => {
			if(docs.has(doc.path))
				throw Object.assign(new Error(`${ALREADY_EXISTS} ALREADY_EXISTS: Document already exists: ${doc.path}`), { code: ALREADY_EXISTS });

			docs.set(doc.path, value);
		});
		return this;
	}

	set(doc, data, options)
	{
		this.#verifyNotCommitted();
		if(options)
			throw new Error('FirestoreMock does not support set() options.');

		const value = toDocumentData(data);

		this.#writes.push(docs => docs.set(doc.path, value));
		return this;
	}

	delete(doc)
	{
		this.#verifyNotCommitted();

		this.#writes.push(docs => docs.delete(doc.path));
		return this;
	}

	async commit()
	{
		this.#verifyNotCommitted();
		this.#committed = true;

		// Apply to a copy so a failing write leaves nothing behind, as batches are atomic
		const docs = new Map(this.#firestore._docs);
		this.#writes.forEach(write => write(docs));
		this.#firestore._docs = docs;

		const writeTime = Timestamp.now();
		return this.#writes.map(() => ({ writeTime }));
	}

	#verifyNotCommitted()
	{
		if(this.#committed)
			throw new Error('Cannot modify a WriteBatch that has been committed.');
	}
}

class CollectionMock 
{
	#firestore = null;
	#where = null;
	path = null;

	constructor(firestore, path, where)
	{
		this.#firestore = firestore;
		this.path = path;
		this.#where = where || (x => x);
	}

	async get()
	{
		const prefix = `${this.path}/`;

		// Immediate children only, in id order, which is Firestore's default ordering
		const docs = [...this.#firestore._docs.keys()]
			.filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
			.sort()
			.map(path => new DocSnapshotMock(new DocumentMock(this.#firestore, path), this.#firestore._docs.get(path)))
			.filter(snap => this.#where(snap.data()));

		return new CollectionSnapshotMock(docs);
	}

	/**
	 * Accepts Firestore's where(fieldPath, opStr, value), or a predicate which is passed each document's data
	 */
	where(predicateOrField, op, value)
	{
		const predicate = typeof predicateOrField === 'function'
			? predicateOrField
			: createFilter(predicateOrField, op, value);

		return new CollectionMock(this.#firestore, this.path, x => this.#where(x) && predicate(x));
	}
}

const fs = new FirestoreMock();
export default fs;

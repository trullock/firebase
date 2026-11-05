import { GeoPoint, Timestamp } from 'firebase-admin/firestore';

const NOT_FOUND = 5;
const ALREADY_EXISTS = 6;

// Returned in place of a FieldValue sentinel, which is applied as a transform after the write instead of being stored
const TRANSFORM = Symbol('transform');

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

	if(isFieldValue(value))
		throw new Error(`${value.methodName}() ${inArray ? 'cannot be used inside of an array' : 'can only be used in set(), create() or update()'}${location}.`);

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

/**
 * Detected by shape rather than instanceof, as a dependant project's firebase-admin may be a different copy to ours.
 * Every FieldValue sentinel (delete, serverTimestamp, increment, arrayUnion etc.) has a methodName getter.
 */
function isFieldValue(value)
{
	return typeof value?.methodName === 'string' && value.methodName.startsWith('FieldValue.');
}

/**
 * FieldPath has no public accessor for its segments, so this relies on the SDK's toArray(). Document paths
 * share the same base class, but have an id.
 */
function isFieldPath(value)
{
	return typeof value?.toArray === 'function' && typeof value.formattedName === 'string' && !('id' in value);
}

/**
 * Splits a field path into segments. Strings use dot notation, while a FieldPath's segments are taken literally,
 * so they can contain dots (e.g. an email address used as a map key).
 */
function toSegments(fieldPath, argument = 'fieldPath')
{
	let segments;
	if(isFieldPath(fieldPath))
		segments = fieldPath.toArray();
	else if(typeof fieldPath === 'string')
		segments = fieldPath.split('.');
	else
		throw new Error(`Value for argument "${argument}" is not a valid field path. Paths can only be specified as strings or via a FieldPath object.`);

	if(segments.length === 0 || segments.some(s => s === ''))
		throw new Error(`Value for argument "${argument}" is not a valid field path. Paths must not be empty, begin with '.', end with '.', or contain '..'.`);

	if(segments.length === 1 && segments[0] === '__name__')
		throw new Error('FieldPath.documentId() is not supported by FirestoreMock.');

	return segments;
}

/**
 * Like toFirestoreValue, but collects FieldValue sentinels in maps into transforms, to be applied once the data is written
 */
function toWriteValue(value, segments, transforms, allowDelete)
{
	if(isFieldValue(value))
	{
		if(value.methodName === 'FieldValue.delete' && !allowDelete)
			throw new Error(`FieldValue.delete() must appear at the top-level and can only be used in update() or set() with {merge:true} (found in field "${segments.join('.')}").`);

		transforms.push({ segments, transform: value });
		return TRANSFORM;
	}

	if(!isPlainObject(value))
		return toFirestoreValue(value, segments.join('.'));

	const result = {};
	for(const [k, v] of Object.entries(value))
	{
		const converted = toWriteValue(v, [...segments, k], transforms, false);
		if(converted !== TRANSFORM)
			result[k] = converted;
	}
	return result;
}

function toDocumentData(data)
{
	if(!isPlainObject(data))
		throw new Error('Value for argument "data" is not a valid Firestore document. Input is not a plain JavaScript object.');

	const transforms = [];
	return { value: toWriteValue(data, [], transforms, false), transforms };
}

/**
 * Parses update()'s arguments, either (data) with dot notation keys, or (field, value, field, value...)
 */
function toUpdateData(dataOrField, moreFieldsOrValues)
{
	let pairs;
	if(isPlainObject(dataOrField))
	{
		if(moreFieldsOrValues.length > 0)
			throw new Error('FirestoreMock does not support update() preconditions.');

		pairs = Object.entries(dataOrField).map(([field, value]) => [toSegments(field, 'dataOrField'), value]);
	}
	else
	{
		const args = [dataOrField, ...moreFieldsOrValues];
		if(args.length % 2 !== 0)
			throw new Error('Function "update()" needs to be called with an even number of arguments when using field/value pairs.');

		pairs = [];
		for(let i = 0; i < args.length; i += 2)
			pairs.push([toSegments(args[i], 'dataOrField'), args[i + 1]]);
	}

	if(pairs.length === 0)
		throw new Error('At least one field must be updated.');

	const names = pairs.map(([segments]) => segments.join('\u0000'));
	names.forEach((name, i) => {
		const conflict = names.find((other, j) => j !== i && (other === name || other.startsWith(name + '\u0000')));
		if(conflict !== undefined)
			throw new Error(`Field "${pairs[i][0].join('.')}" was specified multiple times, or conflicts with "${conflict.split('\u0000').join('.')}".`);
	});

	const transforms = [];
	const fields = [];
	for(const [segments, value] of pairs)
	{
		const converted = toWriteValue(value, segments, transforms, true);
		if(converted !== TRANSFORM)
			fields.push({ segments, value: converted });
	}

	return { fields, transforms };
}

function setField(data, segments, value)
{
	let target = data;
	for(const key of segments.slice(0, -1))
	{
		if(!isPlainObject(target[key]))
			target[key] = {};
		target = target[key];
	}
	target[segments[segments.length - 1]] = value;
}

function deleteField(data, segments)
{
	const parent = getField(data, segments.slice(0, -1));
	if(isPlainObject(parent))
		delete parent[segments[segments.length - 1]];
}

function union(elements, values)
{
	const result = [...elements];
	for(const value of values)
		if(!result.some(e => isEqual(e, value)))
			result.push(value);
	return result;
}

/**
 * Applies transforms to the document as written, as Firestore does. A field the write didn't leave a number or
 * array in is treated as missing, so e.g. increment sets the operand and arrayUnion sets the elements.
 */
function applyTransforms(data, transforms, writeTime)
{
	for(const { segments, transform } of transforms)
	{
		const current = getField(data, segments);
		const name = segments.join('.');

		switch(transform.methodName)
		{
			case 'FieldValue.delete':
				deleteField(data, segments);
				continue;

			case 'FieldValue.serverTimestamp':
				setField(data, segments, writeTime);
				continue;

			case 'FieldValue.increment':
				setField(data, segments, typeof current === 'number' ? current + transform.operand : transform.operand);
				continue;

			case 'FieldValue.minimum':
				setField(data, segments, typeof current === 'number' ? Math.min(current, transform.operand) : transform.operand);
				continue;

			case 'FieldValue.maximum':
				setField(data, segments, typeof current === 'number' ? Math.max(current, transform.operand) : transform.operand);
				continue;

			case 'FieldValue.arrayUnion':
			{
				const elements = transform.elements.map(e => toFirestoreValue(e, name, true));
				setField(data, segments, union(Array.isArray(current) ? current : [], elements));
				continue;
			}

			case 'FieldValue.arrayRemove':
			{
				const elements = transform.elements.map(e => toFirestoreValue(e, name, true));
				setField(data, segments, Array.isArray(current) ? current.filter(v => !elements.some(e => isEqual(v, e))) : []);
				continue;
			}

			default:
				throw new Error(`FirestoreMock does not support ${transform.methodName}() (found in field "${name}").`);
		}
	}
	return data;
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
	for(const key of Array.isArray(fieldPath) ? fieldPath : toSegments(fieldPath))
	{
		if(!isPlainObject(value) || !Object.hasOwn(value, key))
			return undefined;

		value = value[key];
	}
	return value;
}

function createFilter(fieldPath, op, value)
{
	const segments = toSegments(fieldPath);

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
		const field = getField(data, segments);
		return field !== undefined && operators[op](field, operand);
	};
}

/**
 * Detected by shape rather than instanceof, as a dependant project's firebase-admin may be a different copy to ours.
 * The Filter class has no public accessors, so reading one relies on the SDK's internal getters.
 */
function isFilter(value)
{
	return typeof value?._getOperator === 'function';
}

/**
 * Converts a Filter to a predicate, or null if it's a composite with no filters, which Firestore ignores
 */
function compileFilter(filter)
{
	if(typeof filter._getFilters !== 'function')
		return createFilter(filter._getField(), filter._getOperator(), filter._getValue());

	const predicates = filter._getFilters().map(compileFilter).filter(p => p !== null);
	if(predicates.length === 0)
		return null;

	return filter._getOperator() === 'AND'
		? data => predicates.every(p => p(data))
		: data => predicates.some(p => p(data));
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

	collectionGroup = function(collectionId)
	{
		if(typeof collectionId !== 'string' || collectionId === '' || collectionId.includes('/'))
			throw new Error(`Invalid collectionId '${collectionId}'. Collection IDs must be non-empty and must not contain '/'.`);

		return new QueryMock(this, path => {
			const segments = path.split('/');
			return segments[segments.length - 2] === collectionId;
		});
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

	create(data)
	{
		return this.#commitSingle(batch => batch.create(this, data));
	}

	set(data, options)
	{
		return this.#commitSingle(batch => batch.set(this, data, options));
	}

	update(dataOrField, ...moreFieldsOrValues)
	{
		return this.#commitSingle(batch => batch.update(this, dataOrField, ...moreFieldsOrValues));
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
		const { value, transforms } = toDocumentData(data);

		this.#writes.push((docs, writeTime) => {
			if(docs.has(doc.path))
				throw Object.assign(new Error(`${ALREADY_EXISTS} ALREADY_EXISTS: Document already exists: ${doc.path}`), { code: ALREADY_EXISTS });

			docs.set(doc.path, applyTransforms(toFirestoreValue(value), transforms, writeTime));
		});
		return this;
	}

	set(doc, data, options)
	{
		this.#verifyNotCommitted();
		if(options)
			throw new Error('FirestoreMock does not support set() options.');

		const { value, transforms } = toDocumentData(data);

		this.#writes.push((docs, writeTime) => docs.set(doc.path, applyTransforms(toFirestoreValue(value), transforms, writeTime)));
		return this;
	}

	update(doc, dataOrField, ...moreFieldsOrValues)
	{
		this.#verifyNotCommitted();
		const { fields, transforms } = toUpdateData(dataOrField, moreFieldsOrValues);

		this.#writes.push((docs, writeTime) => {
			if(!docs.has(doc.path))
				throw Object.assign(new Error(`${NOT_FOUND} NOT_FOUND: No document to update: ${doc.path}`), { code: NOT_FOUND });

			const data = toFirestoreValue(docs.get(doc.path));
			for(const { segments, value } of fields)
				setField(data, segments, toFirestoreValue(value));

			docs.set(doc.path, applyTransforms(data, transforms, writeTime));
		});
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

		const writeTime = Timestamp.now();

		// Apply to a copy so a failing write leaves nothing behind, as batches are atomic
		const docs = new Map(this.#firestore._docs);
		this.#writes.forEach(write => write(docs, writeTime));
		this.#firestore._docs = docs;

		return this.#writes.map(() => ({ writeTime }));
	}

	#verifyNotCommitted()
	{
		if(this.#committed)
			throw new Error('Cannot modify a WriteBatch that has been committed.');
	}
}

function comparePaths(a, b)
{
	const left = a.split('/');
	const right = b.split('/');
	for(let i = 0; i < Math.min(left.length, right.length); i++)
		if(left[i] !== right[i])
			return left[i] < right[i] ? -1 : 1;

	return left.length - right.length;
}

class QueryMock
{
	#firestore = null;
	#matchesPath = null;
	#where = null;
	#limit = null;

	constructor(firestore, matchesPath, where = null, limit = null)
	{
		this.#firestore = firestore;
		this.#matchesPath = matchesPath;
		this.#where = where || (() => true);
		this.#limit = limit;
	}

	async get()
	{
		// Ordered by document path, which is Firestore's default ordering
		let docs = [...this.#firestore._docs.keys()]
			.filter(this.#matchesPath)
			.sort(comparePaths)
			.map(path => new DocSnapshotMock(new DocumentMock(this.#firestore, path), this.#firestore._docs.get(path)))
			.filter(snap => this.#where(snap.data()));

		if(this.#limit !== null)
			docs = docs.slice(0, this.#limit);

		return new CollectionSnapshotMock(docs);
	}

	/**
	 * Accepts Firestore's where(fieldPath, opStr, value) or where(filter), or a predicate which is passed each document's data
	 */
	where(fieldOrFilter, op, value)
	{
		let predicate;
		if(typeof fieldOrFilter === 'function')
			predicate = fieldOrFilter;
		else if(isFilter(fieldOrFilter))
			predicate = compileFilter(fieldOrFilter);
		else
			predicate = createFilter(fieldOrFilter, op, value);

		if(predicate === null)
			return this;

		return new QueryMock(this.#firestore, this.#matchesPath, x => this.#where(x) && predicate(x), this.#limit);
	}

	/**
	 * Applied after filtering regardless of call order, as in Firestore. A later call replaces an earlier one.
	 */
	limit(limit)
	{
		if(!Number.isInteger(limit) || limit < 0)
			throw new Error('Value for argument "limit" is not a valid integer.');

		return new QueryMock(this.#firestore, this.#matchesPath, this.#where, limit);
	}
}

class CollectionMock extends QueryMock
{
	path = null;

	constructor(firestore, path)
	{
		const prefix = `${path}/`;
		super(firestore, p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
		this.path = path;
	}

	get id()
	{
		return this.path.split('/').pop();
	}
}

const fs = new FirestoreMock();
export default fs;

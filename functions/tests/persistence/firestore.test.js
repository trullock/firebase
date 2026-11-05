import { beforeEach, describe, test } from "node:test";
import assert from "node:assert";
import { FieldPath, FieldValue, Filter, Timestamp } from "firebase-admin/firestore";
import fs from "./firestore.js";

const ids = snap => snap.docs.map(d => d.id);

beforeEach(() => fs.reset());

describe('documents', () => {

	test('get of a missing document', async () => {
		const snap = await fs.doc('things/a').get();

		assert.equal(snap.exists, false);
		assert.equal(snap.data(), undefined);
		assert.equal(snap.id, 'a');
	});

	test('set then get round trips, and overwrites rather than merges', async () => {
		await fs.doc('things/a').set({ one: 1 });
		await fs.doc('things/a').set({ two: { nested: [1, 'x', null, true] } });

		const snap = await fs.doc('things/a').get();
		assert.equal(snap.exists, true);
		assert.deepStrictEqual(snap.data(), { two: { nested: [1, 'x', null, true] } });
	});

	test('stored data is isolated from the caller', async () => {
		const input = { nested: { value: 1 } };
		await fs.doc('things/a').set(input);
		input.nested.value = 2;

		const snap = await fs.doc('things/a').get();
		snap.data().nested.value = 3;

		assert.equal(snap.data().nested.value, 1);
		assert.equal((await fs.doc('things/a').get()).data().nested.value, 1);
	});

	test('a snapshot does not see later writes', async () => {
		await fs.doc('things/a').set({ v: 1 });
		const snap = await fs.doc('things/a').get();
		await fs.doc('things/a').set({ v: 2 });

		assert.equal(snap.data().v, 1);
	});

	test('dates are read back as Timestamps', async () => {
		const date = new Date('2026-01-02T03:04:05.678Z');
		await fs.doc('things/a').set({ date });

		const { date: read } = (await fs.doc('things/a').get()).data();
		assert.ok(read instanceof Timestamp);
		assert.equal(read.toDate().getTime(), date.getTime());
	});

	test('rejects values Firestore rejects', () => {
		class Custom {}

		assert.throws(() => fs.doc('things/a').set({ a: { b: undefined } }), /"undefined".*"a\.b"/);
		assert.throws(() => fs.doc('things/a').set({ a: new Custom() }), /Custom/);
		assert.throws(() => fs.doc('things/a').set({ a: [[1]] }), /nested arrays/);
		assert.throws(() => fs.doc('things/a').set(new Custom()), /plain JavaScript object/);
		assert.throws(() => fs.doc('things/a').set({ a: 1 }, { merge: true }), /options/);
	});

	test('create fails if the document exists', async () => {
		await fs.doc('things/a').create({ n: 1 });

		await assert.rejects(fs.doc('things/a').create({ n: 2 }), e => e.code === 6 && /ALREADY_EXISTS/.test(e.message));
		assert.equal((await fs.doc('things/a').get()).data().n, 1);
	});

	test('delete removes only the document, and tolerates a missing one', async () => {
		await fs.doc('things/a').set({});
		await fs.doc('things/a/children/b').set({});

		await fs.doc('things/a').delete();
		await fs.doc('things/missing').delete();

		assert.equal((await fs.doc('things/a').get()).exists, false);
		assert.equal((await fs.doc('things/a/children/b').get()).exists, true);
	});

	test('recursiveDelete removes descendants but not siblings with the same prefix', async () => {
		await fs.doc('things/a').set({});
		await fs.doc('things/a/children/b').set({});
		await fs.doc('things/a/children/b/grandchildren/c').set({});
		await fs.doc('things/ab').set({});

		await fs.recursiveDelete(fs.doc('things/a'));

		assert.equal((await fs.doc('things/a').get()).exists, false);
		assert.equal((await fs.doc('things/a/children/b').get()).exists, false);
		assert.equal((await fs.doc('things/a/children/b/grandchildren/c').get()).exists, false);
		assert.equal((await fs.doc('things/ab').get()).exists, true);
	});

	test('recursiveDelete accepts a collection', async () => {
		await fs.doc('things/a').set({});
		await fs.doc('things/a/children/b').set({});
		await fs.doc('others/c').set({});

		await fs.recursiveDelete(fs.collection('things'));

		assert.equal((await fs.doc('things/a').get()).exists, false);
		assert.equal((await fs.doc('things/a/children/b').get()).exists, false);
		assert.equal((await fs.doc('others/c').get()).exists, true);
	});

	test('recursiveDelete rejects anything but a reference', async () => {
		await assert.rejects(fs.recursiveDelete('things/a'), /DocumentReference or CollectionReference/);
	});

	test('validates paths', () => {
		assert.throws(() => fs.doc('things'), /must point to a document/);
		assert.throws(() => fs.collection('things/a'), /must point to a collection/);
		assert.throws(() => fs.doc('things//a'), /must not contain/);
		assert.throws(() => fs.doc(''), /non-empty/);
		assert.equal(fs.doc('/things/a/').path, 'things/a');
	});
});

describe('batches', () => {

	test('nothing is visible until commit', async () => {
		const batch = fs.batch();
		batch.create(fs.doc('things/a'), { v: 1 });

		assert.equal((await fs.doc('things/a').get()).exists, false);
		await batch.commit();
		assert.equal((await fs.doc('things/a').get()).exists, true);
	});

	test('writes are applied in order, and methods chain', async () => {
		await fs.doc('things/gone').set({});

		const results = await fs.batch()
			.set(fs.doc('things/a'), { v: 1 })
			.set(fs.doc('things/a'), { v: 2 })
			.delete(fs.doc('things/gone'))
			.commit();

		assert.equal(results.length, 3);
		assert.equal((await fs.doc('things/a').get()).data().v, 2);
		assert.equal((await fs.doc('things/gone').get()).exists, false);
	});

	test('create on an existing document fails the whole batch', async () => {
		await fs.doc('things/a').set({ v: 'original' });

		await assert.rejects(
			fs.batch()
				.set(fs.doc('things/b'), {})
				.create(fs.doc('things/a'), { v: 'new' })
				.commit(),
			{ code: 6 });

		assert.equal((await fs.doc('things/a').get()).data().v, 'original');
		assert.equal((await fs.doc('things/b').get()).exists, false);
	});

	test('data is captured when queued, not at commit', async () => {
		const data = { v: 1 };
		const batch = fs.batch().set(fs.doc('things/a'), data);
		data.v = 2;
		await batch.commit();

		assert.equal((await fs.doc('things/a').get()).data().v, 1);
	});

	test('cannot be reused after commit', async () => {
		const batch = fs.batch();
		await batch.commit();

		assert.throws(() => batch.create(fs.doc('things/a'), {}), /committed/);
		await assert.rejects(batch.commit(), /committed/);
	});
});

describe('collections', () => {

	beforeEach(async () => {
		await fs.doc('things/b').set({ n: 2, s: 'b', tags: ['x', 'y'], nested: { k: 'v' }, nullable: null });
		await fs.doc('things/a').set({ n: 1, s: 'a', tags: ['y'], nested: { k: 'other' }, nullable: 1 });
		await fs.doc('things/c').set({ n: '3', s: 'c' });
		await fs.doc('things/b/children/d').set({ n: 2 });
		await fs.doc('others/e').set({ n: 2 });
	});

	test('get returns immediate children only, ordered by id', async () => {
		const snap = await fs.collection('things').get();

		assert.deepStrictEqual(ids(snap), ['a', 'b', 'c']);
		assert.equal(snap.docs[0].data().n, 1);
		assert.equal(snap.docs[0].ref.path, 'things/a');
		assert.deepStrictEqual(ids(await fs.collection('things/b/children').get()), ['d']);
		assert.deepStrictEqual(ids(await fs.collection('nothing').get()), []);
	});

	const cases = [
		['n', '==', 1, ['a']],
		['n', '!=', 1, ['b', 'c']],
		['n', '<', 2, ['a']],
		['n', '<=', 2, ['a', 'b']],
		['n', '>', 1, ['b']],
		['n', '>=', 1, ['a', 'b']],
		['n', '>', '0', ['c']],
		['nested.k', '==', 'v', ['b']],
		['nested', '==', { k: 'v' }, ['b']],
		['tags', 'array-contains', 'x', ['b']],
		['tags', 'array-contains-any', ['x', 'y'], ['a', 'b']],
		['tags', '==', ['y'], ['a']],
		['s', 'in', ['a', 'c', 'z'], ['a', 'c']],
		['s', 'not-in', ['a'], ['b', 'c']],
		['nullable', '==', null, ['b']],
		['nullable', '!=', null, ['a']],
		['nullable', '!=', 2, ['a']],
		['nullable', 'not-in', [2], ['a']],
		['nullable', 'not-in', [2, null], []],
		['missing', '!=', 1, []]
	];

	for(const [field, op, value, expected] of cases)
		test(`where ${field} ${op} ${JSON.stringify(value)}`, async () => {
			assert.deepStrictEqual(ids(await fs.collection('things').where(field, op, value).get()), expected);
		});

	test('where compares dates and Timestamps', async () => {
		const early = new Date('2026-01-01');
		const late = new Date('2026-06-01');
		await fs.doc('dated/early').set({ at: early });
		await fs.doc('dated/late').set({ at: Timestamp.fromDate(late) });

		assert.deepStrictEqual(ids(await fs.collection('dated').where('at', '>', early).get()), ['late']);
		assert.deepStrictEqual(ids(await fs.collection('dated').where('at', '==', late).get()), ['late']);
	});

	test('where clauses combine, without changing the original query', async () => {
		const all = fs.collection('things');
		const filtered = all.where('n', '>=', 1).where('s', '==', 'b');

		assert.deepStrictEqual(ids(await filtered.get()), ['b']);
		assert.deepStrictEqual(ids(await all.get()), ['a', 'b', 'c']);
	});

	test('where accepts a predicate', async () => {
		const snap = await fs.collection('things').where(d => d.n === 2).where('s', '==', 'b').get();
		assert.deepStrictEqual(ids(snap), ['b']);
	});

	const filterCases = [
		['Filter.where', () => Filter.where('n', '==', 1), ['a']],
		['Filter.or', () => Filter.or(Filter.where('n', '==', 1), Filter.where('s', '==', 'c')), ['a', 'c']],
		['Filter.or matching a document twice returns it once', () => Filter.or(Filter.where('n', '==', 1), Filter.where('s', '==', 'a')), ['a']],
		['Filter.or matching nothing', () => Filter.or(Filter.where('n', '==', 99), Filter.where('s', '==', 'z')), []],
		['Filter.or with a missing field', () => Filter.or(Filter.where('missing', '==', 1), Filter.where('n', '==', 1)), ['a']],
		['Filter.and', () => Filter.and(Filter.where('n', '>=', 1), Filter.where('s', '==', 'b')), ['b']],
		['Filter.and with one failing clause', () => Filter.and(Filter.where('n', '==', 1), Filter.where('s', '==', 'b')), []],
		['or within and', () => Filter.and(
			Filter.where('tags', 'array-contains', 'y'),
			Filter.or(Filter.where('n', '==', 2), Filter.where('s', '==', 'c'))
		), ['b']],
		['and within or', () => Filter.or(
			Filter.and(Filter.where('n', '==', 1), Filter.where('s', '==', 'a')),
			Filter.where('s', '==', 'c')
		), ['a', 'c']],
		['Filter.or with one filter', () => Filter.or(Filter.where('n', '==', 1)), ['a']],
		['empty Filter.or matches everything', () => Filter.or(), ['a', 'b', 'c']],
		['empty Filter.and matches everything', () => Filter.and(), ['a', 'b', 'c']],
		['empty composites are ignored inside Filter.or', () => Filter.or(Filter.and(), Filter.where('n', '==', 1)), ['a']],
		['empty composites are ignored inside Filter.and', () => Filter.and(Filter.or(), Filter.where('n', '==', 1)), ['a']]
	];

	for(const [name, filter, expected] of filterCases)
		test(`where ${name}`, async () => {
			assert.deepStrictEqual(ids(await fs.collection('things').where(filter()).get()), expected);
		});

	test('where returns the same query for an empty composite', () => {
		const things = fs.collection('things');

		assert.strictEqual(things.where(Filter.or()), things);
	});

	test('filters combine with other where clauses', async () => {
		const snap = await fs.collection('things')
			.where(Filter.or(Filter.where('n', '==', 1), Filter.where('n', '==', 2)))
			.where('s', '==', 'b')
			.where(d => d.tags.length === 2)
			.get();

		assert.deepStrictEqual(ids(snap), ['b']);
	});

	test('where rejects invalid filters as soon as they are used', () => {
		const things = fs.collection('things');

		assert.throws(() => things.where(Filter.where('n', 'like', 1)), /opStr/);
		assert.throws(() => things.where(Filter.or(Filter.where('n', '==', 1), Filter.where('n', '<', null))), /Null/);
		assert.throws(() => things.where(Filter.and(Filter.or(Filter.where('n', 'in', [])))), /non-empty/);
		assert.throws(() => things.where(Filter.or('not a filter')), TypeError);
	});

	test('where rejects invalid queries', () => {
		const things = fs.collection('things');

		assert.throws(() => things.where('n', 'like', 1), /opStr/);
		assert.throws(() => things.where('n', '==', undefined), /undefined/);
		assert.throws(() => things.where('n', '<', null), /Null/);
		assert.throws(() => things.where('n', 'in', []), /non-empty/);
		assert.throws(() => things.where('n', 'in', 'a'), /non-empty/);
	});

	test('where accepts a FieldPath', async () => {
		await fs.doc('things/f').set({ 'a.b': { c: 1 } });

		assert.deepStrictEqual(ids(await fs.collection('things').where(new FieldPath('a.b', 'c'), '==', 1).get()), ['f']);
		assert.deepStrictEqual(ids(await fs.collection('things').where(new FieldPath('nested', 'k'), '==', 'v').get()), ['b']);
	});

	test('limit applies after filtering, in id order, whatever order it is called in', async () => {
		const things = fs.collection('things');

		assert.deepStrictEqual(ids(await things.limit(2).get()), ['a', 'b']);
		assert.deepStrictEqual(ids(await things.limit(1).where('n', '==', 2).get()), ['b']);
		assert.deepStrictEqual(ids(await things.where('n', '==', 2).limit(1).get()), ['b']);
		assert.deepStrictEqual(ids(await things.limit(1).limit(3).get()), ['a', 'b', 'c']);
		assert.deepStrictEqual(ids(await things.limit(0).get()), []);
		assert.deepStrictEqual(ids(await things.get()), ['a', 'b', 'c']);
	});

	test('limit rejects invalid values', () => {
		const things = fs.collection('things');

		assert.throws(() => things.limit(-1), /limit/);
		assert.throws(() => things.limit(1.5), /limit/);
		assert.throws(() => things.limit('1'), /limit/);
	});

	test('a collection exposes its path and id, but a query is not a collection', async () => {
		const children = fs.collection('things/b/children');

		assert.equal(children.path, 'things/b/children');
		assert.equal(children.id, 'children');
		await assert.rejects(fs.recursiveDelete(children.where('n', '==', 1)), /DocumentReference or CollectionReference/);
	});
});

describe('collection groups', () => {

	beforeEach(async () => {
		await fs.doc('users/a/events/1').set({ type: 'created' });
		await fs.doc('users/a/events/2').set({ type: 'renamed' });
		await fs.doc('users/b/events/1').set({ type: 'created' });
		await fs.doc('users/b/events/1/events/x').set({ type: 'nested' });
		await fs.doc('events/top').set({ type: 'top' });
		await fs.doc('users/a/other/1').set({ type: 'created' });
		await fs.doc('users/a').set({ type: 'created' });
	});

	const paths = snap => snap.docs.map(d => d.ref.path);

	test('matches collections with the id at any depth, ordered by path', async () => {
		assert.deepStrictEqual(paths(await fs.collectionGroup('events').get()), [
			'events/top',
			'users/a/events/1',
			'users/a/events/2',
			'users/b/events/1',
			'users/b/events/1/events/x'
		]);
		assert.deepStrictEqual(paths(await fs.collectionGroup('nothing').get()), []);
	});

	test('supports where and limit', async () => {
		assert.deepStrictEqual(paths(await fs.collectionGroup('events').where('type', '==', 'created').get()), ['users/a/events/1', 'users/b/events/1']);
		assert.deepStrictEqual(paths(await fs.collectionGroup('events').where(Filter.or(Filter.where('type', '==', 'top'), Filter.where('type', '==', 'nested'))).limit(1).get()), ['events/top']);
	});

	test('rejects invalid collection ids', () => {
		assert.throws(() => fs.collectionGroup('users/a/events'), /collectionId/);
		assert.throws(() => fs.collectionGroup(''), /collectionId/);
	});
});

describe('update', () => {

	beforeEach(async () => {
		await fs.doc('things/a').set({ n: 1, keep: true, map: { x: 1, y: 2 }, scalar: 'text' });
	});

	const data = async () => (await fs.doc('things/a').get()).data();

	test('merges top-level fields, leaving the rest', async () => {
		await fs.doc('things/a').update({ n: 2, added: 'yes' });

		assert.deepStrictEqual(await data(), { n: 2, keep: true, map: { x: 1, y: 2 }, scalar: 'text', added: 'yes' });
	});

	test('dot notation updates nested fields, while a map value replaces the map', async () => {
		await fs.doc('things/a').update({ 'map.x': 10, 'new.deep.field': 1 });
		assert.deepStrictEqual((await data()).map, { x: 10, y: 2 });
		assert.deepStrictEqual((await data()).new, { deep: { field: 1 } });

		await fs.doc('things/a').update({ map: { z: 3 } });
		assert.deepStrictEqual((await data()).map, { z: 3 });
	});

	test('a nested field replaces a non-map value in its path', async () => {
		await fs.doc('things/a').update('scalar.inner', 1);

		assert.deepStrictEqual((await data()).scalar, { inner: 1 });
	});

	test('accepts field/value pairs with strings and FieldPaths, which take segments literally', async () => {
		await fs.doc('things/a').update('n', 5, new FieldPath('map', 'user@example.com', 'opens'), 1, new FieldPath('map', 'x'), 9);

		const result = await data();
		assert.equal(result.n, 5);
		assert.deepStrictEqual(result.map, { x: 9, y: 2, 'user@example.com': { opens: 1 } });
	});

	test('fails when the document does not exist, and fails the whole batch', async () => {
		await assert.rejects(fs.doc('things/missing').update({ n: 1 }), e => e.code === 5 && /NOT_FOUND/.test(e.message));

		const batch = fs.batch().set(fs.doc('things/b'), { n: 1 }).update(fs.doc('things/missing'), { n: 1 });
		await assert.rejects(batch.commit(), /NOT_FOUND/);
		assert.equal((await fs.doc('things/b').get()).exists, false);
	});

	test('in a batch, sees earlier writes in the same batch', async () => {
		await fs.batch()
			.set(fs.doc('things/b'), { n: 1 })
			.update(fs.doc('things/b'), { n: FieldValue.increment(1) })
			.commit();

		assert.equal((await fs.doc('things/b').get()).data().n, 2);
	});

	test('data is captured when queued', async () => {
		const input = { map: { x: 1 } };
		const batch = fs.batch().update(fs.doc('things/a'), input);
		input.map.x = 2;
		await batch.commit();

		assert.equal((await data()).map.x, 1);
	});

	test('rejects invalid arguments', () => {
		const doc = fs.doc('things/a');

		assert.throws(() => doc.update({}), /At least one field/);
		assert.throws(() => doc.update('n'), /even number/);
		assert.throws(() => doc.update('n', 1, 'keep'), /even number/);
		assert.throws(() => doc.update({ 'a..b': 1 }), /field path/);
		assert.throws(() => doc.update(1, 1), /field path/);
		assert.throws(() => doc.update({ map: 1, 'map.x': 2 }), /conflicts/);
		assert.throws(() => doc.update('n', 1, 'n', 2), /multiple times/);
		assert.throws(() => doc.update({ n: undefined }), /undefined/);
		assert.throws(() => doc.update({ n: 1 }, { lastUpdateTime: Timestamp.now() }), /preconditions/);
	});
});

describe('FieldValue', () => {

	beforeEach(async () => {
		await fs.doc('things/a').set({ count: 1, text: 'a', tags: ['x', 'y'], objects: [{ k: 1 }], map: { inner: 1 } });
	});

	const data = async () => (await fs.doc('things/a').get()).data();

	test('increment adds to numbers, and sets the operand otherwise', async () => {
		await fs.doc('things/a').update({ count: FieldValue.increment(2), text: FieldValue.increment(5), 'map.missing': FieldValue.increment(-1) });

		const result = await data();
		assert.equal(result.count, 3);
		assert.equal(result.text, 5);
		assert.equal(result.map.missing, -1);
	});

	test('minimum and maximum', async () => {
		await fs.doc('things/a').update({ count: FieldValue.maximum(4), text: FieldValue.minimum(7) });

		const result = await data();
		assert.equal(result.count, 4);
		assert.equal(result.text, 7);
	});

	test('arrayUnion appends missing elements by value, without duplicates', async () => {
		await fs.doc('things/a').update({
			tags: FieldValue.arrayUnion('y', 'z', 'z'),
			objects: FieldValue.arrayUnion({ k: 1 }, { k: 2 }),
			text: FieldValue.arrayUnion('b'),
			missing: FieldValue.arrayUnion(1)
		});

		const result = await data();
		assert.deepStrictEqual(result.tags, ['x', 'y', 'z']);
		assert.deepStrictEqual(result.objects, [{ k: 1 }, { k: 2 }]);
		assert.deepStrictEqual(result.text, ['b']);
		assert.deepStrictEqual(result.missing, [1]);
	});

	test('arrayRemove removes every equal element, and sets an empty array otherwise', async () => {
		await fs.doc('things/b').set({ tags: ['x', 'y', 'x'], objects: [{ k: 1 }, { k: 2 }] });
		await fs.doc('things/b').update({ tags: FieldValue.arrayRemove('x', 'missing'), objects: FieldValue.arrayRemove({ k: 1 }), other: FieldValue.arrayRemove(1) });

		assert.deepStrictEqual((await fs.doc('things/b').get()).data(), { tags: ['y'], objects: [{ k: 2 }], other: [] });
	});

	test('arrayUnion within a FieldPath update, as used for map keys containing dots', async () => {
		await fs.doc('things/a').update(new FieldPath('recipients', 'user@example.com', 'opens'), FieldValue.arrayUnion({ at: 1 }));
		await fs.doc('things/a').update(new FieldPath('recipients', 'user@example.com', 'opens'), FieldValue.arrayUnion({ at: 2 }));

		assert.deepStrictEqual((await data()).recipients, { 'user@example.com': { opens: [{ at: 1 }, { at: 2 }] } });
	});

	test('serverTimestamp uses the commit time', async () => {
		const before = Timestamp.now();
		await fs.doc('things/a').update({ at: FieldValue.serverTimestamp() });

		const at = (await data()).at;
		assert.ok(at instanceof Timestamp);
		assert.ok(at.toMillis() >= before.toMillis());
	});

	test('delete removes fields, including nested ones, and tolerates missing ones', async () => {
		await fs.doc('things/a').update({ count: FieldValue.delete(), 'map.inner': FieldValue.delete(), 'missing.field': FieldValue.delete() });

		assert.deepStrictEqual(await data(), { text: 'a', tags: ['x', 'y'], objects: [{ k: 1 }], map: { } });
	});

	test('in set and create, transforms apply to the new document, including within maps', async () => {
		await fs.doc('things/a').set({ count: FieldValue.increment(5), tags: FieldValue.arrayUnion('z'), map: { n: FieldValue.increment(1) } });
		assert.deepStrictEqual(await data(), { count: 5, tags: ['z'], map: { n: 1 } });

		await fs.doc('things/b').create({ count: FieldValue.increment(2) });
		assert.deepStrictEqual((await fs.doc('things/b').get()).data(), { count: 2 });
	});

	test('in update, transforms within a map value apply to the replaced map', async () => {
		await fs.doc('things/a').update({ map: { inner: FieldValue.increment(1), other: 'x' } });

		assert.deepStrictEqual((await data()).map, { inner: 1, other: 'x' });
	});

	test('delete is only allowed at the top level of an update', () => {
		assert.throws(() => fs.doc('things/a').set({ count: FieldValue.delete() }), /top-level/);
		assert.throws(() => fs.doc('things/a').create({ count: FieldValue.delete() }), /top-level/);
		assert.throws(() => fs.doc('things/a').update({ map: { inner: FieldValue.delete() } }), /top-level/);
	});

	test('is rejected inside arrays and in queries', () => {
		assert.throws(() => fs.doc('things/a').set({ tags: [FieldValue.increment(1)] }), /inside of an array/);
		assert.throws(() => fs.doc('things/a').update({ tags: [FieldValue.serverTimestamp()] }), /inside of an array/);
		assert.throws(() => fs.collection('things').where('count', '==', FieldValue.increment(1)), /FieldValue.increment/);
	});
});

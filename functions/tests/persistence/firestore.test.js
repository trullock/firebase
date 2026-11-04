import { beforeEach, describe, test } from "node:test";
import assert from "node:assert";
import { Timestamp } from "firebase-admin/firestore";
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

	test('where rejects invalid queries', () => {
		const things = fs.collection('things');

		assert.throws(() => things.where('n', 'like', 1), /opStr/);
		assert.throws(() => things.where('n', '==', undefined), /undefined/);
		assert.throws(() => things.where('n', '<', null), /Null/);
		assert.throws(() => things.where('n', 'in', []), /non-empty/);
		assert.throws(() => things.where('n', 'in', 'a'), /non-empty/);
	});
});

import { beforeEach, describe, test } from "node:test";
import assert from "node:assert";
import { Timestamp } from "firebase-admin/firestore";
import { registerClassForPersistence, registerMapping } from "@trullock/firebase-common";
import AggregateRoot from "../../src/cqrs/aggregateRoot.js";
import CommandContext from "../../src/cqrs/commandContext.js";
import { registerEventHandler } from "../../src/cqrs/eventHandling.js";
import { setErrorHandler, setLogHandler } from "../../src/logging/logger.js";
import {
	deleteEntity,
	deleteProjection,
	deleteQuery,
	getAllEntities,
	getEntity,
	getProjection,
	getSingletonProjection,
	queryProjections,
	saveEntity,
	saveProjection,
	saveSingletonProjection
} from "../../src/persistence/persistence.js";
import fs from "./firestore.js";

class Widget extends AggregateRoot
{
	name = 'unnamed';

	static create(id)
	{
		const widget = new Widget();
		widget.id = id;
		return widget;
	}

	rename(name)
	{
		this.apply('renamed', { name }, ctx);
	}

	onRenamed(data)
	{
		this.name = data.name;
	}
}

class Part
{
	size = 0;
}

class Report
{
	title = 'untitled';
	part = null;
}

class Settings
{
	theme = 'light';
}

class Unregistered
{
	value = 1;
}

registerClassForPersistence(Widget);
registerClassForPersistence(Part);
registerClassForPersistence(Report);
registerClassForPersistence(Settings);

// Dates need a mapping to survive the automapper, as every consuming app has to register
registerMapping(
	(key, value) => value instanceof Date ? Timestamp.fromDate(value) : undefined,
	(key, value) => value instanceof Timestamp ? value.toDate() : undefined
);

const ctx = { issuingUserId: 'user-1', occurredOn: 1000 };

// Subscribers can't be removed via eventHandling.js, so each test uses its own event types
let eventTypeCount = 0;
const uniqueEventType = () => `testEvent${++eventTypeCount}`;

const stored = async path => (await fs.doc(path).get()).data();
const exists = async path => (await fs.doc(path).get()).exists;
const ids = async path => (await fs.collection(path).get()).docs.map(d => d.id);

async function seedWidget(id, name)
{
	const widget = Widget.create(id);
	widget.rename(name);
	await saveEntity(fs, widget, `widgets/${id}`);
}

let reportedErrors = [];

setLogHandler(() => { });
setErrorHandler((message, data) => reportedErrors.push({ message, data }));

beforeEach(() => {
	fs.reset();
	reportedErrors = [];
});

describe('saveEntity', () => {

	test('writes the entity with its type and without its context', async () => {
		const widget = Widget.create('w1');
		widget.setContext(ctx);
		widget.apply('renamed', { name: 'first' });

		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(await stored('widgets/w1'), {
			_type: 'Widget',
			id: 'w1',
			_uncomittedEvents: [],
			_lastEventSequence: 0,
			name: 'first'
		});
	});

	test('does not remove the context from the entity itself', async () => {
		const widget = Widget.create('w1');
		widget.setContext(ctx);
		widget.apply('renamed', { name: 'first' });

		await saveEntity(fs, widget, 'widgets/w1');

		assert.strictEqual(widget._ctx, ctx);
	});

	test('writes each event to a subcollection named after the class, keyed by sequence', async () => {
		const widget = Widget.create('w1');
		widget.rename('first');
		widget.rename('second');

		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(await ids('widgets/w1/WidgetEvents'), ['0', '1']);
		assert.deepStrictEqual(await stored('widgets/w1/WidgetEvents/1'), {
			type: 'renamed',
			sequence: 1,
			data: { name: 'second', aggregateRootId: 'w1', occurredOn: 1000, issuingUserId: 'user-1' }
		});
	});

	test('accepts path segments', async () => {
		const widget = Widget.create('w1');
		widget.rename('first');

		await saveEntity(fs, widget, [Report, 'r1', Widget, 'w1']);

		assert.equal((await stored('Report/r1/Widget/w1')).name, 'first');
		assert.equal(await exists('Report/r1/Widget/w1/WidgetEvents/0'), true);
	});

	test('does nothing when the entity is not dirty', async () => {
		const type = uniqueEventType();
		let published = 0;
		registerEventHandler('counter', type, () => { published++; });

		const widget = Widget.create('w1');
		widget.apply(type, {}, ctx);
		await saveEntity(fs, widget, 'widgets/w1');
		await fs.doc('widgets/w1').set({ overwritten: false });

		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(await stored('widgets/w1'), { overwritten: false });
		assert.equal(published, 1);
	});

	test('continues the event sequence after a reload', async () => {
		await seedWidget('w1', 'first');

		const widget = await getEntity(fs, 'widgets/w1', ctx);
		widget.rename('second');
		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(await ids('widgets/w1/WidgetEvents'), ['0', '1']);
		assert.equal((await stored('widgets/w1')).name, 'second');
	});

	test('rejects a concurrent save, as both copies try to create the same event', async () => {
		await seedWidget('w1', 'first');

		const winner = await getEntity(fs, 'widgets/w1', ctx);
		const loser = await getEntity(fs, 'widgets/w1', ctx);

		winner.rename('winner');
		loser.rename('loser');

		await saveEntity(fs, winner, 'widgets/w1');
		await assert.rejects(saveEntity(fs, loser, 'widgets/w1'), { code: 6 });

		assert.equal((await stored('widgets/w1')).name, 'winner');
		assert.equal((await stored('widgets/w1/WidgetEvents/1')).data.name, 'winner');
	});

	test('rejects an entity it cannot serialize, writing nothing', async () => {
		const widget = Widget.create('w1');
		widget.rename('first');
		widget.extra = new Unregistered();

		await assert.rejects(saveEntity(fs, widget, 'widgets/w1'), /Could not serialize type Unregistered/);

		assert.equal(await exists('widgets/w1'), false);
		assert.deepStrictEqual(await ids('widgets/w1/WidgetEvents'), []);
	});

	test('converts event data for storage, but publishes the original', async () => {
		const type = uniqueEventType();
		const part = new Part();
		let received = null;
		registerEventHandler('capture', type, e => { received = e; });

		const widget = Widget.create('w1');
		widget.apply(type, { part }, ctx);
		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual((await stored('widgets/w1/WidgetEvents/0')).data.part, { _type: 'Part', size: 0 });
		assert.strictEqual(received.part, part);
	});

	test('stores dates in events via registered mappings, but publishes the original data', async () => {
		const type = uniqueEventType();
		const occurredOn = new Date('2026-03-04T05:06:07.000Z');
		let received = null;
		registerEventHandler('capture', type, e => { received = e; });

		const widget = Widget.create('w1');
		widget.apply(type, {}, { issuingUserId: 'user-1', occurredOn });
		await saveEntity(fs, widget, 'widgets/w1');

		const event = await stored('widgets/w1/WidgetEvents/0');
		assert.ok(event.data.occurredOn instanceof Timestamp);
		assert.equal(event.data.occurredOn.toDate().getTime(), occurredOn.getTime());
		assert.strictEqual(received.occurredOn, occurredOn);
	});
});

describe('saveEntity event publishing', () => {

	test('publishes each event to its subscribers with its data', async () => {
		const type = uniqueEventType();
		const received = [];
		registerEventHandler('capture', type, e => { received.push(e); });

		const widget = Widget.create('w1');
		widget.apply(type, { value: 1 }, ctx);
		widget.apply(type, { value: 2 }, ctx);
		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(received.map(e => e.value), [1, 2]);
		assert.equal(received[0].aggregateRootId, 'w1');
	});

	test('publishes only after the batch has committed', async () => {
		const type = uniqueEventType();
		let seen = null;
		registerEventHandler('capture', type, async () => {
			seen = {
				entity: await exists('widgets/w1'),
				event: await exists('widgets/w1/WidgetEvents/0')
			};
		});

		const widget = Widget.create('w1');
		widget.apply(type, {}, ctx);
		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(seen, { entity: true, event: true });
	});

	test('waits for one event\'s handlers to finish before publishing the next', async () => {
		const first = uniqueEventType();
		const second = uniqueEventType();
		const order = [];

		registerEventHandler('slow', first, async () => {
			order.push('first started');
			await new Promise(resolve => setImmediate(resolve));
			order.push('first finished');
		});
		registerEventHandler('fast', second, () => { order.push('second started'); });

		const widget = Widget.create('w1');
		widget.apply(first, {}, ctx);
		widget.apply(second, {}, ctx);
		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(order, ['first started', 'first finished', 'second started']);
	});

	test('publishes nothing when the commit fails', async () => {
		const type = uniqueEventType();
		let published = 0;
		registerEventHandler('counter', type, () => { published++; });
		await fs.doc('widgets/w1/WidgetEvents/0').set({ taken: true });

		const widget = Widget.create('w1');
		widget.apply(type, {}, ctx);

		await assert.rejects(saveEntity(fs, widget, 'widgets/w1'), { code: 6 });

		assert.equal(published, 0);
		assert.equal(await exists('widgets/w1'), false);
	});

	test('reports a rejecting handler, without failing the save or later events', async () => {
		const failing = uniqueEventType();
		const later = uniqueEventType();
		const reason = new Error('handler failed');
		let laterPublished = false;

		registerEventHandler('failing', failing, () => Promise.reject(reason));
		registerEventHandler('later', later, () => { laterPublished = true; });

		const widget = Widget.create('w1');
		widget.apply(failing, {}, ctx);
		widget.apply(later, {}, ctx);
		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(reportedErrors.map(e => e.message), [reason]);
		assert.equal(laterPublished, true);
		assert.equal(await exists('widgets/w1'), true);
	});

	test('reports a throwing handler, without stopping other handlers of the same event', async () => {
		const type = uniqueEventType();
		const reason = new Error('handler threw');
		let otherRan = false;

		registerEventHandler('throwing', type, () => { throw reason; });
		registerEventHandler('other', type, () => { otherRan = true; });

		const widget = Widget.create('w1');
		widget.apply(type, {}, ctx);
		await saveEntity(fs, widget, 'widgets/w1');

		assert.ok(reportedErrors.some(e => e.message === reason));
		assert.equal(otherRan, true);
	});

	test('reports rejections nested in a handler\'s settled results', async () => {
		const type = uniqueEventType();
		const shallow = new Error('shallow');
		const deep = new Error('deep');

		registerEventHandler('nesting', type, () => Promise.allSettled([
			Promise.reject(shallow),
			Promise.allSettled([Promise.reject(deep)]),
			Promise.resolve('fine')
		]));

		const widget = Widget.create('w1');
		widget.apply(type, {}, ctx);
		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(reportedErrors.map(e => e.message), [shallow, deep]);
	});

	test('reports nothing when handlers succeed, whatever they return', async () => {
		const type = uniqueEventType();
		registerEventHandler('returnsArray', type, () => ['a', 1]);
		registerEventHandler('returnsNothing', type, () => { });

		const widget = Widget.create('w1');
		widget.apply(type, {}, ctx);
		await saveEntity(fs, widget, 'widgets/w1');

		assert.deepStrictEqual(reportedErrors, []);
	});
});

// These pin current behaviour that looks unintended. If one starts failing because the behaviour
// was fixed, update the test rather than restoring the behaviour.
describe('known issues', () => {

	test('getEntity throws a TypeError for a missing document', async () => {
		await assert.rejects(getEntity(fs, 'widgets/missing', ctx), TypeError);
	});

	test('a failed save drains the entity\'s events, so a retry silently saves nothing', async () => {
		await fs.doc('widgets/w1/WidgetEvents/0').set({ taken: true });

		const widget = Widget.create('w1');
		widget.rename('first');
		await assert.rejects(saveEntity(fs, widget, 'widgets/w1'), { code: 6 });

		await fs.doc('widgets/w1/WidgetEvents/0').delete();
		await saveEntity(fs, widget, 'widgets/w1');

		assert.equal(widget.isDirty, false);
		assert.equal(await exists('widgets/w1'), false);
	});

	test('a handler returning an array containing null fails the save after it committed, and skips later events', async () => {
		const type = uniqueEventType();
		const later = uniqueEventType();
		let laterPublished = false;

		registerEventHandler('returnsNull', type, () => [null]);
		registerEventHandler('later', later, () => { laterPublished = true; });

		const widget = Widget.create('w1');
		widget.apply(type, {}, ctx);
		widget.apply(later, {}, ctx);

		await assert.rejects(saveEntity(fs, widget, 'widgets/w1'), TypeError);

		assert.equal(await exists('widgets/w1'), true);
		assert.equal(laterPublished, false);
	});

	test('saving with a CommandContext fails unless the class has been registered', async () => {
		const command = new CommandContext();
		command.issuingUserId = 'user-1';
		command.occurredOn = 1000;

		const widget = Widget.create('w1');
		widget.setContext(command);
		widget.apply('renamed', { name: 'first' });

		await assert.rejects(saveEntity(fs, widget, 'widgets/w1'), /Could not serialize type CommandContext/);
	});
});

describe('getEntity', () => {

	test('hydrates the entity\'s class and state, and sets the context', async () => {
		await seedWidget('w1', 'first');

		const widget = await getEntity(fs, 'widgets/w1', ctx);

		assert.ok(widget instanceof Widget);
		assert.equal(widget.id, 'w1');
		assert.equal(widget.name, 'first');
		assert.strictEqual(widget._ctx, ctx);
		assert.equal(widget.isDirty, false);
	});

	test('accepts path segments', async () => {
		const widget = Widget.create('w1');
		widget.rename('first');
		await saveEntity(fs, widget, [Widget, 'w1']);

		assert.equal((await getEntity(fs, [Widget, 'w1'], ctx)).name, 'first');
	});
});

describe('getAllEntities', () => {

	test('hydrates every entity in id order and sets each context', async () => {
		await seedWidget('w2', 'second');
		await seedWidget('w1', 'first');

		const widgets = await getAllEntities(fs, 'widgets', ctx);

		assert.deepStrictEqual(widgets.map(w => w.name), ['first', 'second']);
		assert.ok(widgets.every(w => w instanceof Widget));
		assert.ok(widgets.every(w => w._ctx === ctx));
	});

	test('excludes subcollections', async () => {
		await seedWidget('w1', 'first');

		assert.equal((await getAllEntities(fs, 'widgets', ctx)).length, 1);
	});

	test('returns an empty array for an empty collection', async () => {
		assert.deepStrictEqual(await getAllEntities(fs, 'widgets', ctx), []);
	});

	test('accepts path segments', async () => {
		const widget = Widget.create('w1');
		widget.rename('first');
		await saveEntity(fs, widget, [Report, 'r1', Widget, 'w1']);

		const widgets = await getAllEntities(fs, [Report, 'r1', Widget], ctx);

		assert.deepStrictEqual(widgets.map(w => w.id), ['w1']);
	});
});

const deleteFunctions = { deleteEntity, deleteProjection };

for(const [name, fn] of Object.entries(deleteFunctions))
	describe(name, () => {

		beforeEach(async () => {
			await fs.doc('things/a').set({});
			await fs.doc('things/a/children/b').set({});
			await fs.doc('things/a/children/b/grandchildren/c').set({});
			await fs.doc('things/other').set({});
		});

		for(const deleteChildren of [false, undefined])
			test(`leaves children in place when deleteChildren is ${deleteChildren}`, async () => {
				await fn(fs, 'things/a', deleteChildren);

				assert.equal(await exists('things/a'), false);
				assert.equal(await exists('things/a/children/b'), true);
				assert.equal(await exists('things/other'), true);
			});

		test('deletes all descendants when deleteChildren is true', async () => {
			await fn(fs, 'things/a', true);

			assert.equal(await exists('things/a'), false);
			assert.equal(await exists('things/a/children/b'), false);
			assert.equal(await exists('things/a/children/b/grandchildren/c'), false);
			assert.equal(await exists('things/other'), true);
		});

		for(const deleteChildren of [false, true])
			test(`tolerates a missing document when deleteChildren is ${deleteChildren}`, async () => {
				await fn(fs, 'things/missing', deleteChildren);

				assert.equal(await exists('things/a'), true);
			});

		test('accepts path segments', async () => {
			await fs.doc('Widget/w1').set({});

			await fn(fs, [Widget, 'w1']);

			assert.equal(await exists('Widget/w1'), false);
		});
	});

describe('getProjection', () => {

	test('returns null for a missing document', async () => {
		assert.strictEqual(await getProjection(fs, 'reports/missing'), null);
	});

	test('returns plain data', async () => {
		await fs.doc('reports/r1').set({ title: 'plain', nested: { list: [1, 2] } });

		assert.deepStrictEqual(await getProjection(fs, 'reports/r1'), { title: 'plain', nested: { list: [1, 2] } });
	});

	test('hydrates registered classes, including nested ones', async () => {
		const report = new Report();
		report.title = 'quarterly';
		report.part = new Part();
		report.part.size = 3;
		await saveProjection(fs, report, 'reports/r1');

		const read = await getProjection(fs, 'reports/r1');

		assert.ok(read instanceof Report);
		assert.ok(read.part instanceof Part);
		assert.equal(read.title, 'quarterly');
		assert.equal(read.part.size, 3);
	});

	test('accepts path segments', async () => {
		await fs.doc('Report/r1').set({ title: 'segments' });

		assert.equal((await getProjection(fs, [Report, 'r1'])).title, 'segments');
	});

	test('omits null fields, leaving class defaults in place', async () => {
		await fs.doc('reports/plain').set({ a: null, b: 1 });
		await fs.doc('reports/typed').set({ _type: 'Report', title: null });

		assert.deepStrictEqual(await getProjection(fs, 'reports/plain'), { b: 1 });
		assert.equal((await getProjection(fs, 'reports/typed')).title, 'untitled');
	});
});

describe('saveProjection', () => {

	test('stores the converted projection', async () => {
		const report = new Report();
		report.part = new Part();

		await saveProjection(fs, report, 'reports/r1');

		assert.deepStrictEqual(await stored('reports/r1'), {
			_type: 'Report',
			title: 'untitled',
			part: { _type: 'Part', size: 0 }
		});
	});

	test('replaces the existing document', async () => {
		await saveProjection(fs, { old: true }, 'reports/r1');
		await saveProjection(fs, { new: true }, 'reports/r1');

		assert.deepStrictEqual(await stored('reports/r1'), { new: true });
	});

	test('converts undefined fields to null', async () => {
		await saveProjection(fs, { a: undefined }, 'reports/r1');

		assert.deepStrictEqual(await stored('reports/r1'), { a: null });
	});

	test('round trips dates via registered mappings', async () => {
		const at = new Date('2026-03-04T05:06:07.000Z');

		await saveProjection(fs, { at }, 'reports/r1');

		assert.ok((await stored('reports/r1')).at instanceof Timestamp);
		assert.deepStrictEqual(await getProjection(fs, 'reports/r1'), { at });
	});

	test('accepts path segments', async () => {
		await saveProjection(fs, { a: 1 }, [Report, 'r1']);

		assert.deepStrictEqual(await stored('Report/r1'), { a: 1 });
	});

	test('rejects an unregistered class, writing nothing', async () => {
		await assert.rejects(saveProjection(fs, new Unregistered(), 'reports/r1'), /Could not serialize type Unregistered/);

		assert.equal(await exists('reports/r1'), false);
	});
});

describe('singleton projections', () => {

	test('getSingletonProjection defaults a new instance when none is stored, without storing it', async () => {
		const settings = await getSingletonProjection(fs, Settings);

		assert.ok(settings instanceof Settings);
		assert.equal(settings.theme, 'light');
		assert.equal(await exists('singletons/Settings'), false);
	});

	test('saveSingletonProjection stores under the class name', async () => {
		const settings = new Settings();
		settings.theme = 'dark';

		await saveSingletonProjection(fs, settings);

		assert.deepStrictEqual(await stored('singletons/Settings'), { _type: 'Settings', theme: 'dark' });
	});

	test('getSingletonProjection returns the stored instance', async () => {
		const settings = new Settings();
		settings.theme = 'dark';
		await saveSingletonProjection(fs, settings);

		const read = await getSingletonProjection(fs, Settings);

		assert.ok(read instanceof Settings);
		assert.equal(read.theme, 'dark');
	});

	test('getSingletonProjection rejects an unregistered class when none is stored', async () => {
		await assert.rejects(getSingletonProjection(fs, Unregistered), /Could not serialize type Unregistered/);
	});

	test('saveSingletonProjection rejects an unregistered class', async () => {
		await assert.rejects(saveSingletonProjection(fs, new Unregistered()), /Could not serialize type Unregistered/);
	});
});

describe('queryProjections', () => {

	beforeEach(async () => {
		await fs.doc('scores/a').set({ n: 1 });
		await fs.doc('scores/b').set({ _type: 'Report', title: 'typed', n: 2 });
		await fs.doc('scores/c').set({ n: 3 });
		await fs.doc('scores/c/children/d').set({ n: 3 });
	});

	test('returns the converted documents the filter matches, in id order', async () => {
		const results = await queryProjections(fs, 'scores', q => q.where('n', '>', 1));

		assert.equal(results.length, 2);
		assert.ok(results[0] instanceof Report);
		assert.equal(results[0].title, 'typed');
		assert.deepStrictEqual(results[1], { n: 3 });
	});

	test('passes the collection to the filter', async () => {
		let path = null;
		await queryProjections(fs, 'scores', q => {
			path = q.path;
			return q;
		});

		assert.equal(path, 'scores');
	});

	test('supports chained clauses', async () => {
		const results = await queryProjections(fs, 'scores', q => q.where('n', '>', 1).where('n', '<', 3));

		assert.equal(results[0].title, 'typed');
		assert.equal(results.length, 1);
	});

	test('returns everything for a pass-through filter', async () => {
		assert.equal((await queryProjections(fs, 'scores', q => q)).length, 3);
	});

	test('returns an empty array when nothing matches', async () => {
		assert.deepStrictEqual(await queryProjections(fs, 'scores', q => q.where('n', '>', 99)), []);
	});

	test('accepts path segments', async () => {
		await fs.doc('Report/r1/Part/p1').set({ size: 1 });

		assert.deepStrictEqual(await queryProjections(fs, [Report, 'r1', Part], q => q), [{ size: 1 }]);
	});
});

describe('deleteQuery', () => {

	beforeEach(async () => {
		await fs.doc('scores/a').set({ n: 1 });
		await fs.doc('scores/b').set({ n: 2 });
		await fs.doc('scores/b/children/c').set({ n: 2 });
		await fs.doc('other/d').set({ n: 2 });
	});

	test('deletes only the documents the filter matches', async () => {
		await deleteQuery(fs, 'scores', q => q.where('n', '==', 2));

		assert.deepStrictEqual(await ids('scores'), ['a']);
		assert.equal(await exists('other/d'), true);
	});

	test('leaves the subcollections of deleted documents in place', async () => {
		await deleteQuery(fs, 'scores', q => q.where('n', '==', 2));

		assert.equal(await exists('scores/b/children/c'), true);
	});

	test('resolves with a result for each deletion', async () => {
		assert.equal((await deleteQuery(fs, 'scores', q => q)).length, 2);
	});

	test('does nothing when nothing matches', async () => {
		assert.deepStrictEqual(await deleteQuery(fs, 'scores', q => q.where('n', '>', 99)), []);

		assert.deepStrictEqual(await ids('scores'), ['a', 'b']);
	});

	test('accepts path segments', async () => {
		await fs.doc('Report/r1/Part/p1').set({});

		await deleteQuery(fs, [Report, 'r1', Part], q => q);

		assert.equal(await exists('Report/r1/Part/p1'), false);
	});
});

import { beforeEach, describe, test } from "node:test";
import assert from "node:assert";
import { gunzipSync } from "node:zlib";
import storage from "./storage.js";

beforeEach(() => storage.reset());

describe('files', () => {

	test('save then download round trips strings and buffers', async () => {
		const file = storage.bucket().file('media/a');
		await file.save('hello', { contentType: 'application/octet-stream' });
		assert.equal((await file.download())[0].toString(), 'hello');

		await file.save(Buffer.from([1, 2, 3]));
		assert.deepStrictEqual([...(await file.download())[0]], [1, 2, 3]);
	});

	test('exists, and missing files', async () => {
		const file = storage.bucket().file('missing');

		assert.deepStrictEqual(await file.exists(), [false]);
		await assert.rejects(file.download(), e => e.code === 404 && /No such object/.test(e.message));
		await assert.rejects(file.getMetadata(), e => e.code === 404);

		await file.save('x');
		assert.deepStrictEqual(await file.exists(), [true]);
	});

	test('metadata includes the content type, size and names', async () => {
		const file = storage.bucket().file('media/a');
		await file.save('hello', { contentType: 'image/png', metadata: { cacheControl: 'public' } });

		const [metadata] = await file.getMetadata();
		assert.equal(metadata.contentType, 'image/png');
		assert.equal(metadata.cacheControl, 'public');
		assert.equal(metadata.size, '5');
		assert.equal(metadata.name, 'media/a');
		assert.equal(metadata.bucket, storage.bucket().name);
		assert.equal(metadata.contentEncoding, undefined);
		assert.ok(Date.parse(metadata.updated));
	});

	test('gzip auto compresses compressible types, and download decompresses unless told not to', async () => {
		const svg = storage.bucket().file('media/svg');
		await svg.save('<svg/>', { contentType: 'image/svg+xml', gzip: 'auto' });

		assert.equal((await svg.getMetadata())[0].contentEncoding, 'gzip');
		assert.equal((await svg.download())[0].toString(), '<svg/>');
		assert.equal(gunzipSync((await svg.download({ decompress: false }))[0]).toString(), '<svg/>');

		const png = storage.bucket().file('media/png');
		await png.save('png', { contentType: 'image/png', gzip: 'auto' });

		assert.equal((await png.getMetadata())[0].contentEncoding, undefined);
		assert.equal((await png.download({ decompress: false }))[0].toString(), 'png');
	});

	test('gzip true compresses regardless of type', async () => {
		const file = storage.bucket().file('a');
		await file.save('data', { contentType: 'image/png', gzip: true });

		assert.equal((await file.getMetadata())[0].contentEncoding, 'gzip');
		assert.equal((await file.download())[0].toString(), 'data');
	});

	test('stored data is isolated from the caller', async () => {
		const input = Buffer.from('abc');
		const file = storage.bucket().file('a');
		await file.save(input);
		input[0] = 0;

		const [downloaded] = await file.download();
		downloaded[1] = 0;

		assert.equal((await file.download())[0].toString(), 'abc');
	});

	test('delete removes the file, and fails for missing files unless ignored', async () => {
		const file = storage.bucket().file('a');
		await file.save('x');
		await file.delete();

		assert.deepStrictEqual(await file.exists(), [false]);
		await assert.rejects(file.delete(), e => e.code === 404);
		await file.delete({ ignoreNotFound: true });
	});

	test('save rejects invalid data, and file requires a name', async () => {
		await assert.rejects(storage.bucket().file('a').save({ not: 'data' }), TypeError);
		assert.throws(() => storage.bucket().file(''), /name/);
	});
});

describe('buckets', () => {

	test('files are scoped to their bucket', async () => {
		await storage.bucket().file('a').save('default');
		await storage.bucket('other').file('a').save('other');

		assert.equal((await storage.bucket().file('a').download())[0].toString(), 'default');
		assert.equal((await storage.bucket('other').file('a').download())[0].toString(), 'other');
	});

	test('getFiles lists by prefix, in name order', async () => {
		for(const name of ['media/b', 'media/a', 'emails/c'])
			await storage.bucket().file(name).save('x');
		await storage.bucket('other').file('media/z').save('x');

		const [media] = await storage.bucket().getFiles({ prefix: 'media/' });
		assert.deepStrictEqual(media.map(f => f.name), ['media/a', 'media/b']);

		const [all] = await storage.bucket().getFiles();
		assert.deepStrictEqual(all.map(f => f.name), ['emails/c', 'media/a', 'media/b']);
	});
});

test('reset clears all files', async () => {
	await storage.bucket().file('a').save('x');
	storage.reset();

	assert.deepStrictEqual(await storage.bucket().file('a').exists(), [false]);
});

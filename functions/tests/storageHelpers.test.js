import { beforeEach, describe, test } from "node:test";
import assert from "node:assert";
import storage from "./storage.js";
import { getFile, uploadFileBase64, uploadFileUtf8 } from "../src/storage.js";

beforeEach(() => storage.reset());

describe('storage helpers', () => {

	test('upload to, and find files in, the storage they are given', async () => {
		await uploadFileUtf8(storage, 'emails/a', '<p>Hi</p>', 'text/html');

		let file = await getFile(storage, 'emails/a');

		assert.equal((await file.getMetadata())[0].contentType, 'text/html');
	});

	test('upload a PNG data URL as the image it holds', async () => {
		let png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

		await uploadFileBase64(storage, 'media/a', 'data:image/png;base64,' + png.toString('base64'), 'image/png');

		assert.deepStrictEqual([...(await (await getFile(storage, 'media/a')).download())[0]], [...png]);
	});

	test('find nothing where there is no file', async () => {
		assert.equal(await getFile(storage, 'media/missing'), null);
	});
});

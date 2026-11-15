import { gunzipSync, gzipSync } from 'node:zlib';

const DEFAULT_BUCKET = 'mock-project.appspot.com';

// The SDK's list of compressible content types, which gzip: 'auto' compresses
const COMPRESSIBLE = /^text\/|application\/(ecmascript|javascript|json|postscript|rtf|toml|vnd\.dart|vnd\.ms-fontobject|wasm|x-httpd-php|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|xml)|font\/(otf|ttf)|image\/(bmp|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp|svg\+xml)|message\/rfc822|model\/(gltf-binary|x3d\+binary|x3d\+vrml)|\+(json|text|xml)$/;

/**
 * Matches the SDK's ApiError, whose code is the HTTP status
 */
function notFound(bucket, name)
{
	return Object.assign(new Error(`No such object: ${bucket}/${name}`), { code: 404 });
}

function toBuffer(data)
{
	if(Buffer.isBuffer(data))
		return Buffer.from(data);

	if(typeof data === 'string' || data instanceof Uint8Array)
		return Buffer.from(data);

	throw new TypeError('The "data" argument must be a string, Buffer or Uint8Array.');
}

class FileMock
{
	#storage = null;
	bucket = null;
	name = null;

	constructor(storage, bucket, name)
	{
		this.#storage = storage;
		this.bucket = bucket;
		this.name = name;
	}

	get #key()
	{
		return `${this.bucket.name}/${this.name}`;
	}

	#get()
	{
		const stored = this.#storage._files.get(this.#key);
		if(!stored)
			throw notFound(this.bucket.name, this.name);
		return stored;
	}

	/**
	 * Supports contentType, gzip (true, false or 'auto') and metadata, as save() does
	 */
	async save(data, options = {})
	{
		const metadata = { ...options.metadata };
		if(options.contentType)
			metadata.contentType = options.contentType;

		const gzip = options.gzip === 'auto' ? COMPRESSIBLE.test(metadata.contentType ?? '') : !!options.gzip;
		if(gzip)
			metadata.contentEncoding = 'gzip';

		const buffer = toBuffer(data);
		const now = new Date().toISOString();
		const existing = this.#storage._files.get(this.#key);

		this.#storage._files.set(this.#key, {
			data: gzip ? gzipSync(buffer) : buffer,
			metadata: {
				...metadata,
				name: this.name,
				bucket: this.bucket.name,
				size: String(buffer.length),
				timeCreated: existing?.metadata.timeCreated ?? now,
				updated: now
			}
		});
	}

	/**
	 * Resolves to [contents], decompressing gzipped files unless decompress is false, as download() does
	 */
	async download(options = {})
	{
		const { data, metadata } = this.#get();
		const decompress = options.decompress !== false && metadata.contentEncoding === 'gzip';
		return [decompress ? gunzipSync(data) : Buffer.from(data)];
	}

	async exists()
	{
		return [this.#storage._files.has(this.#key)];
	}

	async getMetadata()
	{
		return [structuredClone(this.#get().metadata)];
	}

	async delete(options = {})
	{
		if(!this.#storage._files.delete(this.#key) && !options.ignoreNotFound)
			throw notFound(this.bucket.name, this.name);
		return [{}];
	}
}

class BucketMock
{
	#storage = null;
	name = null;

	constructor(storage, name)
	{
		this.#storage = storage;
		this.name = name;
	}

	file(name)
	{
		if(typeof name !== 'string' || name === '')
			throw new Error('A file name must be specified.');

		return new FileMock(this.#storage, this, name);
	}

	/**
	 * Resolves to [files] whose names start with prefix, in name order
	 */
	async getFiles(options = {})
	{
		const prefix = `${this.name}/${options.prefix ?? ''}`;
		const names = [...this.#storage._files.keys()]
			.filter(key => key.startsWith(prefix))
			.map(key => key.slice(this.name.length + 1))
			.sort();

		return [names.map(name => new FileMock(this.#storage, this, name))];
	}
}

/**
 * An in-memory stand-in for firebase-admin's Storage, covering the File methods used to store and serve uploads
 */
class StorageMock
{
	_files = new Map();

	bucket(name = DEFAULT_BUCKET)
	{
		return new BucketMock(this, name);
	}

	/**
	 * Not part of Firebase. Clears all files, as the exported instance is shared between tests.
	 */
	reset()
	{
		this._files = new Map();
	}
}

const storage = new StorageMock();
export default storage;

/**
 * Each takes the Storage to use, e.g. firebase-admin's getStorage() or a mock in tests, and uses its default bucket
 */

// base64 is a PNG data URL: its 22 character prefix, data:image/png;base64, is dropped
export function uploadFileBase64(storage, name, base64, contentType)
{
	return uploadFileBuffer(storage, name, Buffer.from(base64.substr(22), 'base64'), contentType)
}

export function uploadFileUtf8(storage, name, utf8, contentType)
{
	return uploadFileBuffer(storage, name, Buffer.from(utf8, 'utf8'), contentType);
}

export async function uploadFileBuffer(storage, name, buffer, contentType)
{
	let file = storage.bucket().file(name)
	await file.save(buffer, {
		gzip: 'auto',
		contentType: contentType
	})
	return file;
}

/**
 * The file at path, or null if there isn't one
 */
export async function getFile(storage, path)
{
	let file = storage.bucket().file(path)

	let [exists] = await file.exists();
	if(!exists)
		return null;

	return file;
}

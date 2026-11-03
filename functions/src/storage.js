import { getStorage }  from 'firebase-admin/storage';

export function uploadFileBase64(name, base64, contentType)
{
	return uploadFileBuffer(name, Buffer.from(base64.substr(22), 'base64'), contentType)
}

export function uploadFileUtf8(name, utf8, contentType)
{
	return uploadFileBuffer(name, Buffer.from(utf8, 'utf8'), contentType);
}

export async function uploadFileBuffer(name, buffer, contentType)
{
	let bucket = getStorage().bucket();
	let file = bucket.file(name)
	await file.save(buffer, {
		gzip: 'auto',
		contentType: contentType
	})
	return file;
}

export async function getFile(path)
{
	let bucket = getStorage().bucket();
	let file = bucket.file(path)

	let exists = await file.exists();

	if(!exists[0])
		return null;

	return file;
}
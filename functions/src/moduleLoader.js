import { resolve } from 'path';
import { readdir } from 'node:fs/promises';
import { logger } from 'firebase-functions';

export async function loadModules({
	filter = /.*.js$/,
	rootDir
}) 
{
	const modules = {};
	
	let files = await readdir(rootDir, { recursive: true });
	logger.debug(`Found ${files.length} files to filter`)

	files = files.filter(f => filter.test(f));
	logger.debug(`Filtered ${files.length} files`)

	for (const file of files)
	{
		logger.debug(`Processing ${file}`)

		const fileAbsPath = resolve(rootDir, file);
		const fileRelPath = fileAbsPath.slice(rootDir.length + 1);
		
		try
		{
			const mod = await import(fileAbsPath);
			modules[fileRelPath] = mod;
		} catch (err)
		{
			logger.error(`Skipping ${fileRelPath}, failed to import module`, err)
		}
	}

	return modules;
}
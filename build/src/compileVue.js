import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { init, parse as parseImports } from 'es-module-lexer/js';

// Points relative imports, which were relative to the .vue file, at the same files from the compiled file
async function rewriteImports(code, srcFile, outFile)
{
	await init;

	let srcDir = path.dirname(srcFile);
	let outDir = path.dirname(outFile);
	let [imports] = parseImports(code);

	let result = code;
	// backwards, so earlier offsets stay valid as the string changes
	for(let imp of [...imports].reverse())
	{
		// skip import.meta and anything that isn't a plain string specifier
		if(imp.type !== 'static' && imp.type !== 'dynamic')
			continue;

		let spec = imp.specifier;
		if(!spec || !spec.startsWith('.'))
			continue;

		let rel = path.relative(outDir, path.resolve(srcDir, spec)).split(path.sep).join('/');
		if(!rel.startsWith('.'))
			rel = './' + rel;

		// static imports' ranges exclude the quotes; dynamic imports' may include them
		let raw = code.slice(imp.start, imp.end);
		let quote = /^['"`]/.test(raw) ? raw[0] : '';

		result = result.slice(0, imp.start) + quote + rel + quote + result.slice(imp.end);
	}
	return result;
}

/**
 * Compiles a .vue file to an ES module to be written at outFile, for server-side rendering: its <script>'s exports,
 * plus ssrRender from its <template>. compilerOptions are the template compiler's.
 * @returns {Promise<string>} the module's code
 */
export async function compileVue(srcFile, outFile, compilerOptions = {})
{
	let source = await fs.readFile(srcFile, 'utf8');
	// from the file rather than random, so an unchanged file compiles to the same code and isn't rewritten
	let id = createHash('sha256').update(srcFile).digest('hex').slice(0, 8);

	let { descriptor, errors } = parse(source, { filename: srcFile });
	if(errors.length)
		throw errors[0];

	let script = compileScript(descriptor, { id });

	let template = compileTemplate({
		source: descriptor.template.content,
		filename: srcFile,
		id,
		ssr: true,
		ssrCssVars: descriptor.cssVars,
		compilerOptions: { ...compilerOptions, bindingMetadata: script.bindings }
	});
	if(template.errors.length)
		throw template.errors[0];

	return rewriteImports(script.content + '\n' + template.code, srcFile, outFile);
}

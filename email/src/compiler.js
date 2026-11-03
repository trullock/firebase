import fs from 'node:fs/promises'
import path from 'node:path'
import {
	parse,
	compileScript,
	compileTemplate
} from '@vue/compiler-sfc'
import { init, parse as parseImports } from 'es-module-lexer/js'

async function rewriteImports(code, srcFile, outFile) {
	await init

	const srcDir = path.dirname(path.resolve(srcFile))
	const outDir = path.dirname(path.resolve(outFile))
	const [imports] = parseImports(code)

	let result = code
	// Go backwards so earlier offsets stay valid as the string changes
	for (const imp of [...imports].reverse())
	{
		// Skip import.meta and anything that isn't a plain string specifier
		if (imp.type !== 'static' && imp.type !== 'dynamic')
			continue

		const spec = imp.specifier
		if (!spec || !spec.startsWith('.'))
			continue // leave 'vue', 'lodash', etc. alone

		let target = path.resolve(srcDir, spec)

		let rel = path.relative(outDir, target).split(path.sep).join('/')
		if (!rel.startsWith('.'))
			rel = './' + rel

		// Static imports: start/end exclude the quotes.
		// Dynamic imports: the range may include them, so preserve them if present.
		const raw = code.slice(imp.start, imp.end)
		const quote = /^['"`]/.test(raw) ? raw[0] : ''

		result = result.slice(0, imp.start) + quote + rel + quote + result.slice(imp.end)
	}
	return result
}

export async function compileSFC(filename) {
	const source = await fs.readFile(filename, 'utf8')
	const id = Math.random().toString(36).slice(2, 10)

	// 1. Parse into template / script / style blocks
	const { descriptor, errors } = parse(source, { filename })
	if (errors.length)
		throw errors[0]

	// 2. Script (handles both <script> and <script setup>)
	let script = compileScript(descriptor, { id })
	// script = rewriteDefault(script.content, 'handleEvent')

	const tpl = compileTemplate({
		source: descriptor.template.content,
		filename,
		id,
		ssr: true,
		compilerOptions: { bindingMetadata: script.bindings },
	})
	if (tpl.errors.length)
		throw tpl.errors[0]

	return { 
		script: script.content, 
		template: tpl.code
	}
}

export async function compileEmail(filename, outDir) {
	let { script, template } = await compileSFC(filename)

	let outPath = path.join(outDir, `${path.parse(filename).name}.js`)
	let output = script + '\n' + template;
	output = await rewriteImports(output, filename, outPath)
	await fs.writeFile(outPath, output)
	return outPath;
}
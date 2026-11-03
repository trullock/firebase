// compile.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import {
	parse,
	compileScript,
	compileTemplate,
	compileStyle
} from '@vue/compiler-sfc'

export async function compileSFC(filename) {
	const source = await fs.readFile(filename, 'utf8')
	const id = Math.random().toString(36).slice(2, 10)

	// 1. Parse into template / script / style blocks
	const { descriptor, errors } = parse(source, { filename })
	if (errors.length)
		throw errors[0]

	// 2. Script (handles both <script> and <script setup>)
	const script = compileScript(descriptor, { id })

	const tpl = compileTemplate({
		source: descriptor.template.content,
		filename,
		id,
		ssr: true,
		compilerOptions: { bindingMetadata: script.bindings },
	})
	if (tpl.errors.length)
		throw tpl.errors[0]

	// 4. Optional: compile styles to plain CSS
	const css = descriptor.styles
		.map(s => compileStyle({ source: s.content, filename, id: `data-v-${id}`, scoped: s.scoped }).code)
		.join('\n')

	return { 
		script: script.content, 
		template: tpl.code,
		css: css
	}
}

export async function compileEmail(filename) {
	const { script, template, css } = await compileSFC(filename)

	let scriptPath = path.join(path.dirname(filename), `.${path.basename(filename)}.compiled.script.js`)
	await fs.writeFile(scriptPath, script)

	let templatePath = path.join(path.dirname(filename), `.${path.basename(filename)}.compiled.template.js`)
	await fs.writeFile(templatePath, template)
}

// // Write the compiled module next to the project so `import 'vue'` resolves
// async function loadComponent(filename) {
// 	const { code, css } = await compileSFC(filename)
// 	const out = path.join(path.dirname(filename), `.${path.basename(filename)}.compiled.mjs`)
// 	await fs.writeFile(out, code)
// 	const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`) // cache-bust
// 	return { component: mod.default, css }
// }

// // Usage
// const { component, css } = await loadComponent('./Hello.vue')
// const html = await renderToString(createSSRApp(component, { name: 'World' }))
// console.log(html)
// console.log(css)
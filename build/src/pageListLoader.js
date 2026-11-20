import fs from 'node:fs';
import path from 'node:path';
import { parse as parseJs } from '@babel/parser';
import { parse as parseVue } from '@vue/compiler-sfc';

/**
 * The source of a module's named export, without importing it: for `export const x = <expr>` just <expr>, otherwise
 * the whole declaration. Null if it has no such export.
 */
export function getExportSource(code, exportName)
{
	let body = parseJs(code, { sourceType: 'module' }).program.body;

	let declarationOf = node => node.type === 'ExportNamedDeclaration' ? node.declaration : node;

	let findLocal = name => body.find(node => {
		let d = declarationOf(node);
		if(!d)
			return false;
		if(d.id?.name === name)
			return true;
		return d.declarations?.some(v => v.id.name === name);
	});

	let sliceDeclaration = node => {
		let d = declarationOf(node);
		if(d.type === 'VariableDeclaration' && d.declarations.length === 1 && d.declarations[0].init)
		{
			let init = d.declarations[0].init;
			return code.slice(init.start, init.end);
		}
		return code.slice(d.start, d.end);
	};

	for(let node of body)
	{
		if(node.type !== 'ExportNamedDeclaration')
			continue;

		if(node.declaration)
		{
			let d = node.declaration;
			let names = d.id ? [d.id.name] : d.declarations?.map(v => v.id.name) ?? [];
			if(names.includes(exportName))
				return sliceDeclaration(node);
		}

		for(let spec of node.specifiers ?? [])
		{
			let exported = spec.exported.name ?? spec.exported.value;
			if(exported === exportName && !node.source)
			{
				let local = findLocal(spec.local.name);
				return local ? sliceDeclaration(local) : null;
			}
		}
	}

	return null;
}

function listPages(pagesDir)
{
	return fs.readdirSync(pagesDir, { recursive: true })
		.filter(f => f.endsWith('.vue') || f.endsWith('.js'))
		.sort()
		.map(f => path.join(pagesDir, f));
}

function readPageScript(filePath)
{
	let source = fs.readFileSync(filePath, 'utf-8');
	if(filePath.endsWith('.js'))
		return source;

	let { descriptor, errors } = parseVue(source, { filename: filePath });
	if(errors.length)
		throw new Error(`Failed to parse page ${filePath}: ${errors[0].message}`);

	return descriptor.script?.content;
}

/**
 * Webpack loader for the module that registers the app's pages, replacing it with code registering every page in the
 * pages folder from its opts, using registerInlinePage, registerInlineVuePage and registerLazyVuePage.
 * - .js pages have no markup, and are bundled and registered up front.
 * - .vue pages with opts.inline are bundled and registered up front, e.g. the loading page shown while lazy pages load.
 * - Other .vue pages are lazy loaded in production, and bundled in development.
 * opts must be statically parseable, as it's copied into the page list in production.
 * It depends on the pages folder and each page, so in watch mode adding, removing or editing a page regenerates it.
 * Options:
 * - pagesDir: the pages folder, relative to webpack's context (default 'pages'). Every .vue and .js file in it must be a page.
 * - pagesModule: the module exporting the register functions, as the page list imports it (default './pages.js').
 */
export default function pageListLoader()
{
	let { pagesDir = 'pages', pagesModule = './pages.js' } = this.getOptions();
	pagesDir = path.resolve(this.rootContext, pagesDir);

	this.addContextDependency(pagesDir);

	let isProduction = this.mode == 'production';
	let fromDir = path.dirname(this.resourcePath);

	let pages = listPages(pagesDir).map((filePath, i) => {
		this.addDependency(filePath);

		let script = readPageScript(filePath);
		// pages can't be imported here, so opts is read as source, and evaluated to read its values
		let optsSource = script && getExportSource(script, 'opts');
		if(!optsSource)
			throw new Error(`${filePath} doesn't export opts. Every .vue and .js file in ${pagesDir} must be a page`);

		let opts = new Function(`return (${optsSource})`)();
		let importPath = path.relative(fromDir, filePath).split(path.sep).join('/');
		if(!importPath.startsWith('.'))
			importPath = './' + importPath;

		let kind = 'lazy';
		if(filePath.endsWith('.js'))
			kind = 'script';
		else if(opts.inline)
			kind = 'inline';

		return { i, importPath, optsSource, kind };
	});

	let order = { script: 0, inline: 1, lazy: 2 };
	let registrations = pages
		.sort((a, b) => order[a.kind] - order[b.kind])
		.map(({ i, importPath, optsSource, kind }) => {
			if(kind == 'script')
				return `import * as page${i} from '${importPath}';\nregisterInlinePage(page${i});`;

			if(kind == 'inline')
				return `import * as page${i} from '${importPath}';\nregisterInlineVuePage(page${i});`;

			if(isProduction)
				return `registerLazyVuePage(${optsSource}, () => import('${importPath}'));`;

			return `import * as page${i} from '${importPath}';\nregisterLazyVuePage(page${i}.opts, () => page${i});`;
		});

	return `import { registerInlinePage, registerInlineVuePage, registerLazyVuePage } from '${pagesModule}';\n\n` + registrations.join('\n\n') + '\n';
}

import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pageListLoader, { getExportSource } from '../src/pageListLoader.js';

async function appWith(pages)
{
	let root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-'));
	for(let [file, source] of Object.entries(pages))
	{
		await fs.mkdir(path.join(root, 'pages', path.dirname(file)), { recursive: true });
		await fs.writeFile(path.join(root, 'pages', file), source);
	}
	return root;
}

const vuePage = opts => `<script>\nexport const opts = ${opts}\nexport default {}\n</script>\n<template><div></div></template>\n`;

function load(root, { mode = 'development', options = {} } = {})
{
	let dependencies = [];
	let contextDependencies = [];
	let source = pageListLoader.call({
		mode,
		rootContext: root,
		resourcePath: path.join(root, 'js', 'page-list.js'),
		getOptions: () => options,
		addDependency: f => dependencies.push(f),
		addContextDependency: d => contextDependencies.push(d)
	});
	return { source, dependencies, contextDependencies };
}

describe('build/pageListLoader', () => {
	test('registers script and inline pages first, bundling every page in development', async () => {
		let root = await appWith({
			'home.vue': vuePage(`{ route: '/' }`),
			'loading.vue': vuePage(`{ route: '/loading', inline: true }`),
			'account/sign-out.js': `export const opts = { route: '/sign-out' }\nexport default class {}\n`
		});

		let { source, dependencies, contextDependencies } = load(root);

		assert.strictEqual(source, [
			`import { registerInlinePage, registerInlineVuePage, registerLazyVuePage } from './pages.js';`,
			``,
			`import * as page0 from '../pages/account/sign-out.js';\nregisterInlinePage(page0);`,
			``,
			`import * as page2 from '../pages/loading.vue';\nregisterInlineVuePage(page2);`,
			``,
			`import * as page1 from '../pages/home.vue';\nregisterLazyVuePage(page1.opts, () => page1);`,
			``
		].join('\n'));
		assert.deepStrictEqual(contextDependencies, [path.join(root, 'pages')]);
		assert.strictEqual(dependencies.length, 3);
	});

	test('lazy loads pages in production, copying their opts', async () => {
		let root = await appWith({ 'home.vue': vuePage(`{ route: '/', title: 'Home' }`) });

		let { source } = load(root, { mode: 'production' });

		assert.match(source, /registerLazyVuePage\(\{ route: '\/', title: 'Home' \}, \(\) => import\('\.\.\/pages\/home\.vue'\)\);/);
	});

	test('takes the pages folder and registration module from its options', async () => {
		let root = await appWith({ 'home.vue': vuePage(`{ route: '/' }`) });
		await fs.rename(path.join(root, 'pages'), path.join(root, 'views'));

		let { source } = load(root, { options: { pagesDir: 'views', pagesModule: '@app/pages' } });

		assert.match(source, /from '@app\/pages';/);
		assert.match(source, /from '\.\.\/views\/home\.vue'/);
	});

	test('fails for a file in the pages folder that isn\'t a page', async () => {
		let root = await appWith({ 'widget.vue': `<script>\nexport default {}\n</script>\n` });

		assert.throws(() => load(root), /widget\.vue doesn't export opts/);
	});

	test('reads an export\'s source however it is exported', () => {
		assert.strictEqual(getExportSource(`export const opts = { a: 1 }`, 'opts'), '{ a: 1 }');
		assert.strictEqual(getExportSource(`const o = { a: 1 }\nexport { o as opts }`, 'opts'), '{ a: 1 }');
		assert.strictEqual(getExportSource(`export function opts() {}`, 'opts'), 'function opts() {}');
		assert.strictEqual(getExportSource(`export default {}`, 'opts'), null);
	});
});

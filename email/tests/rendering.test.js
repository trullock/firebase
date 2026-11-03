import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { compileSFC } from "../src/compiler.js";

test('render', async t => {
	let result = await compileSFC(path.resolve('./tests/example.vue'))
	debugger;
})
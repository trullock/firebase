import { afterEach } from 'node:test';
import { setDebugHandler, setLogHandler } from '../src/logging/logger.js';

/**
 * Imported for its effects, before anything else under test: silences logging, and fails any test that calls fetch(),
 * so code calling an external service has to have it mocked
 */

setLogHandler(() => {});
setDebugHandler(() => {});

let disallowed = [];

// Calls are usually inside try/catch or the callable's error handling, so throwing alone could be swallowed and the test pass
globalThis.fetch = async input => {
	let error = new Error(`fetch(${input?.url ?? input}) is not allowed in tests. Swap the service for a mock.`);
	disallowed.push(error);
	throw error;
};

afterEach(() => {
	let [error] = disallowed;
	disallowed = [];
	if(error)
		throw error;
});

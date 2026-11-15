import { describe, test } from 'node:test';
import assert from 'node:assert';
import { explainError } from '../src/errors.js';

function firebaseError(code, message)
{
	return Object.assign(new Error(message), { name: 'FirebaseError', code });
}

describe('explainError', () => {

	test('adds the context, an explanation and the original code and message, keeping the code and cause', () => {
		let original = firebaseError('functions/internal', 'internal');

		let explained = explainError(original, 'Calling command academies-changeName');

		assert.strictEqual(explained.code, 'functions/internal');
		assert.strictEqual(explained.cause, original);
		let lines = explained.message.split('\n');
		assert.strictEqual(lines[0], 'Calling command academies-changeName');
		assert.match(lines[1], /not be deployed in this region/);
		assert.strictEqual(lines.at(-1), 'functions/internal: internal');
	});

	test('says whether a permissions error was for a document or a collection', () => {
		let get = explainError(firebaseError('permission-denied', "Null value error. for 'get' @ L12"), 'Failed to get AcademyView/a');
		let list = explainError(firebaseError('permission-denied', "false for 'list' @ L30"), 'Failed to query AcademyView');

		assert.match(get.message, /Denied getting a document/);
		assert.match(list.message, /Denied listing a collection/);
		assert.match(get.message, /security rules denied/);
	});

	test('pulls out the link to create a missing index', () => {
		let link = 'https://console.firebase.google.com/v1/r/project/governorlink/firestore/indexes?create_composite=abc123';
		let explained = explainError(firebaseError('failed-precondition', `The query requires an index. You can create it here: ${link}`), 'Failed to query UserTask');

		assert.match(explained.message, new RegExp(`Create the index at ${link.replace(/[?]/g, '\\?')}`));
	});

	test('explains every Firestore error code', () => {
		let codes = ['cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found', 'already-exists', 'permission-denied', 'resource-exhausted',
			'failed-precondition', 'aborted', 'out-of-range', 'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated'];

		for(let code of codes)
			assert.strictEqual(explainError(firebaseError(code, 'x'), 'Doing something').message.split('\n').length, 3, code);
	});

	test('still adds context to Firebase errors it has no explanation for', () => {
		let explained = explainError(firebaseError('auth/some-new-code', 'Firebase: Error (auth/some-new-code).'), 'Signing in');

		assert.strictEqual(explained.message, 'Signing in\nauth/some-new-code: Firebase: Error (auth/some-new-code).');
		assert.strictEqual(explained.code, 'auth/some-new-code');
	});

	test('returns other errors unchanged', () => {
		let error = new TypeError('Cannot read properties of undefined');

		assert.strictEqual(explainError(error, 'Doing something'), error);
		assert.strictEqual(explainError(undefined, 'Doing something'), undefined);
	});
});

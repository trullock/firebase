import { beforeEach, describe, test } from "node:test";
import assert from "node:assert";
import auth from "./auth.js";

const code = expected => e => e.code === `auth/${expected}`;

beforeEach(() => auth.reset());

describe('users', () => {

	test('createUser returns a record, with defaults, which getUser and getUserByEmail find', async () => {
		const created = await auth.createUser({ uid: 'u1', email: 'Someone@Example.com', displayName: 'Someone' });

		assert.equal(created.uid, 'u1');
		assert.equal(created.email, 'someone@example.com');
		assert.equal(created.emailVerified, false);
		assert.equal(created.disabled, false);
		assert.equal(created.displayName, 'Someone');
		assert.equal(created.photoURL, undefined);
		assert.equal(created.customClaims, undefined);
		assert.ok(Date.parse(created.metadata.creationTime));

		assert.deepStrictEqual(await auth.getUser('u1'), created);
		assert.deepStrictEqual(await auth.getUserByEmail('SOMEONE@example.com'), created);
	});

	test('createUser generates a uid when none is given', async () => {
		const a = await auth.createUser({});
		const b = await auth.createUser();

		assert.ok(a.uid.length > 0);
		assert.notEqual(a.uid, b.uid);
	});

	test('createUser rejects duplicates and invalid properties', async () => {
		await auth.createUser({ uid: 'u1', email: 'a@example.com' });

		await assert.rejects(auth.createUser({ uid: 'u1' }), code('uid-already-exists'));
		await assert.rejects(auth.createUser({ email: 'A@example.com' }), code('email-already-exists'));
		await assert.rejects(auth.createUser({ uid: '' }), code('invalid-uid'));
		await assert.rejects(auth.createUser({ uid: 'x'.repeat(129) }), code('invalid-uid'));
		await assert.rejects(auth.createUser({ email: 'not an email' }), code('invalid-email'));
		await assert.rejects(auth.createUser({ password: '12345' }), code('invalid-password'));
		await assert.rejects(auth.createUser({ photoURL: 'not a url' }), code('invalid-photo-url'));
		await assert.rejects(auth.createUser({ phoneNumber: '0123' }), code('argument-error'));
		await assert.rejects(auth.createUser({ emailVerified: 'yes' }), code('argument-error'));
		await assert.rejects(auth.createUser(null), code('argument-error'));
	});

	test('missing users are not found', async () => {
		await assert.rejects(auth.getUser('missing'), e => code('user-not-found')(e) && /no user record/.test(e.message));
		await assert.rejects(auth.getUserByEmail('missing@example.com'), code('user-not-found'));
		await assert.rejects(auth.updateUser('missing', { displayName: 'x' }), code('user-not-found'));
		await assert.rejects(auth.deleteUser('missing'), code('user-not-found'));
	});

	test('updateUser changes only the given properties, and null removes optional ones', async () => {
		await auth.createUser({ uid: 'u1', email: 'a@example.com', displayName: 'A', photoURL: 'https://example.com/a.png' });

		const updated = await auth.updateUser('u1', { email: 'B@example.com', emailVerified: true, photoURL: null });

		assert.equal(updated.email, 'b@example.com');
		assert.equal(updated.emailVerified, true);
		assert.equal(updated.displayName, 'A');
		assert.equal(updated.photoURL, undefined);
		assert.deepStrictEqual(await auth.getUserByEmail('b@example.com'), updated);
		await assert.rejects(auth.getUserByEmail('a@example.com'), code('user-not-found'));
	});

	test('updateUser rejects an email owned by someone else, but not the user\'s own, and leaves the user unchanged when invalid', async () => {
		await auth.createUser({ uid: 'u1', email: 'a@example.com' });
		await auth.createUser({ uid: 'u2', email: 'b@example.com' });

		await assert.rejects(auth.updateUser('u1', { email: 'b@example.com' }), code('email-already-exists'));
		await auth.updateUser('u1', { email: 'A@example.com' });

		await assert.rejects(auth.updateUser('u1', { displayName: 'New', password: 'short' }), code('invalid-password'));
		assert.equal((await auth.getUser('u1')).displayName, undefined);
	});

	test('records are copies of the stored user', async () => {
		await auth.createUser({ uid: 'u1' });
		await auth.setCustomUserClaims('u1', { role: { name: 'admin' } });

		const record = await auth.getUser('u1');
		record.customClaims.role.name = 'changed';
		record.metadata.creationTime = 'changed';

		const fresh = await auth.getUser('u1');
		assert.equal(fresh.customClaims.role.name, 'admin');
		assert.notEqual(fresh.metadata.creationTime, 'changed');
	});

	test('deleteUser removes the user, freeing their email', async () => {
		await auth.createUser({ uid: 'u1', email: 'a@example.com' });
		await auth.deleteUser('u1');

		await assert.rejects(auth.getUser('u1'), code('user-not-found'));
		await auth.createUser({ uid: 'u2', email: 'a@example.com' });
	});

	test('deleteUsers counts missing users as deleted, and reports invalid uids by index', async () => {
		await auth.createUser({ uid: 'u1' });
		await auth.createUser({ uid: 'u2' });

		const result = await auth.deleteUsers(['u1', 'missing', '', 'u2']);

		assert.equal(result.successCount, 3);
		assert.equal(result.failureCount, 1);
		assert.equal(result.errors[0].index, 2);
		assert.equal(result.errors[0].error.code, 'auth/invalid-uid');
		assert.deepStrictEqual((await auth.listUsers()).users, []);

		await assert.rejects(auth.deleteUsers('u1'), code('argument-error'));
		await assert.rejects(auth.deleteUsers(Array(1001).fill('u')), code('maximum-user-count-exceeded'));
	});

	test('listUsers pages in uid order', async () => {
		for(const uid of ['c', 'a', 'e', 'b', 'd'])
			await auth.createUser({ uid });

		const first = await auth.listUsers(2);
		assert.deepStrictEqual(first.users.map(u => u.uid), ['a', 'b']);

		const second = await auth.listUsers(2, first.pageToken);
		assert.deepStrictEqual(second.users.map(u => u.uid), ['c', 'd']);

		const last = await auth.listUsers(2, second.pageToken);
		assert.deepStrictEqual(last.users.map(u => u.uid), ['e']);
		assert.equal(last.pageToken, undefined);

		assert.deepStrictEqual((await auth.listUsers()).users.map(u => u.uid), ['a', 'b', 'c', 'd', 'e']);
		assert.equal((await auth.listUsers(5)).pageToken, undefined);
	});

	test('listUsers rejects invalid arguments', async () => {
		await assert.rejects(auth.listUsers(0), code('argument-error'));
		await assert.rejects(auth.listUsers(1001), code('argument-error'));
		await assert.rejects(auth.listUsers(10, ''), code('invalid-page-token'));
	});
});

describe('custom claims', () => {

	beforeEach(async () => {
		await auth.createUser({ uid: 'u1', email: 'a@example.com' });
	});

	test('are set, replaced and cleared', async () => {
		await auth.setCustomUserClaims('u1', { isAdmin: true, a1: { role: 'governor' } });
		assert.deepStrictEqual((await auth.getUser('u1')).customClaims, { isAdmin: true, a1: { role: 'governor' } });

		await auth.setCustomUserClaims('u1', { a2: { role: 'staff' } });
		assert.deepStrictEqual((await auth.getUser('u1')).customClaims, { a2: { role: 'staff' } });

		await auth.setCustomUserClaims('u1', null);
		assert.equal((await auth.getUser('u1')).customClaims, undefined);
	});

	test('are stored as a copy', async () => {
		const claims = { a1: { role: 'governor' } };
		await auth.setCustomUserClaims('u1', claims);
		claims.a1.role = 'changed';

		assert.equal((await auth.getUser('u1')).customClaims.a1.role, 'governor');
	});

	test('reject reserved claims, oversized payloads and missing users', async () => {
		await assert.rejects(auth.setCustomUserClaims('u1', { sub: 'x' }), e => code('forbidden-claim')(e) && /"sub"/.test(e.message));
		await assert.rejects(auth.setCustomUserClaims('u1', { firebase: {} }), code('forbidden-claim'));
		await assert.rejects(auth.setCustomUserClaims('u1', { big: 'x'.repeat(1000) }), code('claims-too-large'));
		await assert.rejects(auth.setCustomUserClaims('u1', ['x']), code('invalid-claims'));
		await assert.rejects(auth.setCustomUserClaims('missing', {}), code('user-not-found'));
	});
});

describe('tokens', () => {

	beforeEach(async () => {
		await auth.createUser({ uid: 'u1', email: 'a@example.com', emailVerified: true, displayName: 'A', photoURL: 'https://example.com/a.png' });
	});

	test('createIdToken returns a token that verifyIdToken decodes, with the user\'s details and claims', async () => {
		await auth.setCustomUserClaims('u1', { isAdmin: true });

		const decoded = await auth.verifyIdToken(await auth.createIdToken('u1'));

		assert.equal(decoded.uid, 'u1');
		assert.equal(decoded.sub, 'u1');
		assert.equal(decoded.email, 'a@example.com');
		assert.equal(decoded.email_verified, true);
		assert.equal(decoded.name, 'A');
		assert.equal(decoded.picture, 'https://example.com/a.png');
		assert.equal(decoded.isAdmin, true);
		assert.equal(decoded.firebase.sign_in_provider, 'password');
		assert.ok(decoded.exp > decoded.iat);
	});

	test('claims are fixed when the token is issued', async () => {
		const before = await auth.createIdToken('u1');
		await auth.setCustomUserClaims('u1', { isAdmin: true });
		const after = await auth.createIdToken('u1');

		assert.equal((await auth.verifyIdToken(before)).isAdmin, undefined);
		assert.equal((await auth.verifyIdToken(after)).isAdmin, true);
	});

	test('createIdToken updates lastSignInTime, and rejects missing or disabled users', async () => {
		await auth.createIdToken('u1');
		assert.ok(Date.parse((await auth.getUser('u1')).metadata.lastSignInTime));

		await assert.rejects(auth.createIdToken('missing'), code('user-not-found'));
		await auth.updateUser('u1', { disabled: true });
		await assert.rejects(auth.createIdToken('u1'), code('user-disabled'));
	});

	test('verifyIdToken rejects unknown and malformed tokens', async () => {
		await assert.rejects(auth.verifyIdToken('not-a-token'), code('invalid-id-token'));
		await assert.rejects(auth.verifyIdToken(''), code('argument-error'));
		await assert.rejects(auth.verifyIdToken(undefined), code('argument-error'));
	});

	test('verifyIdToken with checkRevoked rejects tokens for deleted or disabled users', async () => {
		const token = await auth.createIdToken('u1');
		await auth.verifyIdToken(token, true);

		await auth.updateUser('u1', { disabled: true });
		await assert.rejects(auth.verifyIdToken(token, true), code('user-disabled'));
		await auth.verifyIdToken(token);

		await auth.deleteUser('u1');
		await assert.rejects(auth.verifyIdToken(token, true), code('user-not-found'));
	});

	test('decoded tokens are copies', async () => {
		const token = await auth.createIdToken('u1');
		(await auth.verifyIdToken(token)).firebase.sign_in_provider = 'changed';

		assert.equal((await auth.verifyIdToken(token)).firebase.sign_in_provider, 'password');
	});

	test('createCustomToken can be exchanged for an ID token including its developer claims', async () => {
		await auth.setCustomUserClaims('u1', { isAdmin: true });
		const custom = await auth.createCustomToken('u1', { impersonated: true });

		const decoded = await auth.verifyIdToken(await auth.signInWithCustomToken(custom));

		assert.equal(decoded.uid, 'u1');
		assert.equal(decoded.isAdmin, true);
		assert.equal(decoded.impersonated, true);
		assert.equal(decoded.firebase.sign_in_provider, 'custom');
		await assert.rejects(auth.verifyIdToken(custom), code('invalid-id-token'));
	});

	test('signing in with a custom token creates the user if they don\'t exist', async () => {
		const custom = await auth.createCustomToken('new-user');
		await auth.signInWithCustomToken(custom);

		assert.equal((await auth.getUser('new-user')).uid, 'new-user');
	});

	test('createCustomToken rejects invalid arguments', async () => {
		await assert.rejects(auth.createCustomToken(''), code('invalid-uid'));
		await assert.rejects(auth.createCustomToken('u1', { aud: 'x' }), code('forbidden-claim'));
		await assert.rejects(auth.signInWithCustomToken('nonsense'), code('argument-error'));
	});
});

describe('email action links', () => {

	beforeEach(async () => {
		await auth.createUser({ uid: 'u1', email: 'a@example.com' });
	});

	const query = link => new URL(link).searchParams;

	test('verification and password reset links are recorded, with a query string the client can use', async () => {
		const verify = await auth.generateEmailVerificationLink('A@example.com');
		const reset = await auth.generatePasswordResetLink('a@example.com', { url: 'https://app.example.com/done' });

		assert.equal(query(verify).get('mode'), 'verifyEmail');
		assert.equal(query(reset).get('mode'), 'resetPassword');
		assert.equal(query(reset).get('continueUrl'), 'https://app.example.com/done');
		assert.ok(query(verify).get('oobCode'));
		assert.notEqual(query(verify).get('oobCode'), query(reset).get('oobCode'));

		assert.deepStrictEqual(auth.actionLinks.map(l => [l.mode, l.email, l.link]), [
			['verifyEmail', 'a@example.com', verify],
			['resetPassword', 'a@example.com', reset]
		]);
		assert.equal(auth.actionLinks[0].oobCode, query(verify).get('oobCode'));
	});

	test('verification and password reset links require an existing user', async () => {
		await assert.rejects(auth.generateEmailVerificationLink('missing@example.com'), code('email-not-found'));
		await assert.rejects(auth.generatePasswordResetLink('missing@example.com'), code('email-not-found'));
		await assert.rejects(auth.generatePasswordResetLink('not an email'), code('invalid-email'));
		assert.deepStrictEqual(auth.actionLinks, []);
	});

	test('sign in links don\'t need an existing user, but require settings', async () => {
		const link = await auth.generateSignInWithEmailLink('new@example.com', { url: 'https://app.example.com/', handleCodeInApp: true });
		await auth.generateSignInWithEmailLink('new@example.com', { url: 'https://app.example.com/' });

		assert.equal(query(link).get('mode'), 'signIn');
		assert.equal(auth.actionLinks[0].email, 'new@example.com');

		await assert.rejects(auth.generateSignInWithEmailLink('new@example.com'), code('missing-continue-uri'));
		await assert.rejects(auth.generateSignInWithEmailLink('new@example.com', { url: 'not a url' }), code('invalid-continue-uri'));
		await assert.rejects(auth.generateSignInWithEmailLink('new@example.com', { url: 'https://app.example.com/', handleCodeInApp: 'yes' }), code('argument-error'));
	});
});

test('reset clears users, tokens and links', async () => {
	await auth.createUser({ uid: 'u1', email: 'a@example.com' });
	const token = await auth.createIdToken('u1');
	await auth.generateEmailVerificationLink('a@example.com');

	auth.reset();

	await assert.rejects(auth.getUser('u1'), code('user-not-found'));
	await assert.rejects(auth.verifyIdToken(token), code('invalid-id-token'));
	assert.deepStrictEqual(auth.actionLinks, []);
});

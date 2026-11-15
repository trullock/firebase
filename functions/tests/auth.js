import { randomBytes } from 'node:crypto';

// https://firebase.google.com/docs/auth/admin/custom-claims#set_and_validate_custom_user_claims_via_the_admin_sdk
const RESERVED_CLAIMS = ['acr', 'amr', 'at_hash', 'aud', 'auth_time', 'azp', 'cnf', 'c_hash', 'exp', 'iat', 'iss', 'jti', 'nbf', 'nonce', 'sub', 'firebase'];
const MAX_CLAIMS_SIZE = 1000;
const MAX_DELETE_USERS = 1000;
const MAX_LIST_USERS = 1000;

const errors = {
	'argument-error': 'Invalid argument.',
	'claims-too-large': 'Developer claims maximum payload size exceeded.',
	'email-already-exists': 'The email address is already in use by another account.',
	'email-not-found': 'There is no user record corresponding to the provided email.',
	'forbidden-claim': 'The specified developer claim is reserved and cannot be specified.',
	'invalid-claims': 'The provided custom claim attributes are invalid.',
	'invalid-continue-uri': 'The continue URL must be a valid URL string.',
	'invalid-display-name': 'The displayName field must be a valid string.',
	'invalid-email': 'The email address is improperly formatted.',
	'invalid-id-token': 'The provided ID token is not a valid Firebase ID token.',
	'invalid-page-token': 'The page token must be a valid non-empty string.',
	'invalid-password': 'The password must be a string with at least 6 characters.',
	'invalid-photo-url': 'The photoURL field must be a valid URL.',
	'invalid-uid': 'The uid must be a non-empty string with at most 128 characters.',
	'maximum-user-count-exceeded': 'The maximum allowed number of users to import has been exceeded.',
	'missing-continue-uri': 'A valid continue URL must be provided in the request.',
	'uid-already-exists': 'The user with the provided uid already exists.',
	'user-disabled': 'The user record is disabled.',
	'user-not-found': 'There is no user record corresponding to the provided identifier.'
};

/**
 * Matches FirebaseAuthError's code and message, which callers branch on
 */
function authError(code, message)
{
	return Object.assign(new Error(message ?? errors[code]), { code: `auth/${code}` });
}

const randomId = (bytes = 21) => randomBytes(bytes).toString('base64url');

function normaliseEmail(email)
{
	if(typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(email))
		throw authError('invalid-email');

	// Firebase stores emails lowercased, and looks them up case insensitively
	return email.toLowerCase();
}

function validateUid(uid)
{
	if(typeof uid !== 'string' || uid.length === 0 || uid.length > 128)
		throw authError('invalid-uid');
}

function validateClaims(claims)
{
	if(claims === null)
		return;

	if(typeof claims !== 'object' || Array.isArray(claims))
		throw authError('invalid-claims');

	const reserved = Object.keys(claims).find(k => RESERVED_CLAIMS.includes(k));
	if(reserved)
		throw authError('forbidden-claim', `Developer claim "${reserved}" is reserved and cannot be specified.`);

	if(JSON.stringify(claims).length > MAX_CLAIMS_SIZE)
		throw authError('claims-too-large', `Developer claims payload should not exceed ${MAX_CLAIMS_SIZE} characters.`);
}

function validateActionCodeSettings(settings, required)
{
	if(settings === undefined && !required)
		return;

	if(typeof settings?.url !== 'string' || settings.url === '')
		throw authError('missing-continue-uri');

	try
	{
		new URL(settings.url);
	}
	catch
	{
		throw authError('invalid-continue-uri');
	}

	if(settings.handleCodeInApp !== undefined && typeof settings.handleCodeInApp !== 'boolean')
		throw authError('argument-error', '"ActionCodeSettings.handleCodeInApp" must be a boolean.');
}

/**
 * Deep copies, so callers can't mutate stored state through a returned record
 */
const copy = value => value === undefined ? undefined : structuredClone(value);

class UserRecordMock
{
	constructor(user)
	{
		this.uid = user.uid;
		this.email = user.email;
		this.emailVerified = user.emailVerified;
		this.displayName = user.displayName;
		this.photoURL = user.photoURL;
		this.phoneNumber = user.phoneNumber;
		this.disabled = user.disabled;
		this.metadata = { ...user.metadata };
		this.providerData = copy(user.providerData);
		this.customClaims = copy(user.customClaims);
	}

	toJSON()
	{
		return { ...this };
	}
}

/**
 * An in-memory stand-in for firebase-admin's Auth, covering user management, custom claims, tokens and email action links.
 * ID tokens can't be minted by the Admin SDK, so createIdToken() stands in for a client signing in.
 */
class AuthMock
{
	_users = new Map();
	_idTokens = new Map();
	_customTokens = new Map();

	/**
	 * Not part of Firebase. Every email action link generated, oldest first, so tests can assert on and follow them.
	 */
	actionLinks = [];

	async createUser(properties = {})
	{
		const uid = properties?.uid ?? randomId();
		validateUid(uid);

		if(this._users.has(uid))
			throw authError('uid-already-exists');

		const user = {
			uid,
			email: undefined,
			emailVerified: false,
			displayName: undefined,
			photoURL: undefined,
			phoneNumber: undefined,
			password: undefined,
			disabled: false,
			metadata: { creationTime: new Date().toUTCString(), lastSignInTime: null, lastRefreshTime: null },
			providerData: [],
			customClaims: undefined
		};

		this.#applyProperties(user, properties);
		this._users.set(uid, user);

		return new UserRecordMock(user);
	}

	async getUser(uid)
	{
		validateUid(uid);
		return new UserRecordMock(this.#getUser(uid));
	}

	async getUserByEmail(email)
	{
		return new UserRecordMock(this.#getUserByEmail(normaliseEmail(email)));
	}

	async updateUser(uid, properties)
	{
		validateUid(uid);
		const user = this.#getUser(uid);

		// Validate against a copy, so an invalid property leaves the user unchanged
		const updated = { ...user, metadata: { ...user.metadata } };
		this.#applyProperties(updated, properties);
		this._users.set(uid, updated);

		return new UserRecordMock(updated);
	}

	async deleteUser(uid)
	{
		validateUid(uid);
		this.#getUser(uid);
		this._users.delete(uid);
	}

	/**
	 * Like Firebase, missing users count as successfully deleted, and invalid uids are reported per index rather than thrown
	 */
	async deleteUsers(uids)
	{
		if(!Array.isArray(uids))
			throw authError('argument-error', 'uids must be a non-null array');

		if(uids.length > MAX_DELETE_USERS)
			throw authError('maximum-user-count-exceeded', `\`uids\` parameter must have <= ${MAX_DELETE_USERS} entries.`);

		const result = { successCount: 0, failureCount: 0, errors: [] };
		uids.forEach((uid, index) => {
			try
			{
				validateUid(uid);
				this._users.delete(uid);
				result.successCount++;
			}
			catch(error)
			{
				result.failureCount++;
				result.errors.push({ index, error });
			}
		});
		return result;
	}

	/**
	 * Pages through users in uid order. The page token is the last uid of the previous page.
	 */
	async listUsers(maxResults = MAX_LIST_USERS, pageToken)
	{
		if(!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_LIST_USERS)
			throw authError('argument-error', `Required "maxResults" must be a positive integer that does not exceed ${MAX_LIST_USERS}.`);

		if(pageToken !== undefined && (typeof pageToken !== 'string' || pageToken === ''))
			throw authError('invalid-page-token');

		const uids = [...this._users.keys()].sort().filter(uid => pageToken === undefined || uid > pageToken);
		const page = uids.slice(0, maxResults);

		return {
			users: page.map(uid => new UserRecordMock(this._users.get(uid))),
			pageToken: uids.length > maxResults ? page[page.length - 1] : undefined
		};
	}

	async setCustomUserClaims(uid, customUserClaims)
	{
		validateUid(uid);
		validateClaims(customUserClaims);

		const user = this.#getUser(uid);
		user.customClaims = customUserClaims === null ? undefined : copy(customUserClaims);
	}

	/**
	 * Unlike Firebase, the token is opaque rather than a signed JWT. Exchange it with signInWithCustomToken() to get an ID token.
	 */
	async createCustomToken(uid, developerClaims)
	{
		validateUid(uid);
		if(developerClaims !== undefined)
			validateClaims(developerClaims);

		const token = `mock-custom-token.${randomId()}`;
		this._customTokens.set(token, { uid, developerClaims: copy(developerClaims) });
		return token;
	}

	/**
	 * Returns the decoded token, with the user's custom claims as they were when the token was issued, as in Firebase.
	 * checkRevoked only checks the user still exists and isn't disabled, as tokens can't be revoked.
	 */
	async verifyIdToken(idToken, checkRevoked = false)
	{
		if(typeof idToken !== 'string' || idToken === '')
			throw authError('argument-error', 'First argument to verifyIdToken() must be a Firebase ID token string.');

		const decoded = this._idTokens.get(idToken);
		if(!decoded)
			throw authError('invalid-id-token');

		if(checkRevoked)
		{
			const user = this._users.get(decoded.uid);
			if(!user)
				throw authError('user-not-found');

			if(user.disabled)
				throw authError('user-disabled');
		}

		return copy(decoded);
	}

	async generateEmailVerificationLink(email, actionCodeSettings)
	{
		validateActionCodeSettings(actionCodeSettings, false);
		return this.#generateLink('verifyEmail', this.#getUserByEmail(normaliseEmail(email), 'email-not-found').email, actionCodeSettings);
	}

	async generatePasswordResetLink(email, actionCodeSettings)
	{
		validateActionCodeSettings(actionCodeSettings, false);
		return this.#generateLink('resetPassword', this.#getUserByEmail(normaliseEmail(email), 'email-not-found').email, actionCodeSettings);
	}

	/**
	 * Unlike the other links, the user doesn't need to exist, as signing in with the link creates them, but settings are required.
	 * The client SDK requires handleCodeInApp to be true, but the Admin SDK doesn't.
	 */
	async generateSignInWithEmailLink(email, actionCodeSettings)
	{
		validateActionCodeSettings(actionCodeSettings, true);
		return this.#generateLink('signIn', normaliseEmail(email), actionCodeSettings);
	}

	/**
	 * Not part of Firebase. Stands in for a client signing in as the user, returning an ID token to pass to verifyIdToken().
	 * Its claims are fixed when it's created, so call it again after changing the user's claims.
	 */
	async createIdToken(uid, { signInProvider = 'password' } = {})
	{
		validateUid(uid);
		const user = this.#getUser(uid);

		if(user.disabled)
			throw authError('user-disabled');

		return this.#issueIdToken(user, {}, signInProvider);
	}

	/**
	 * Not part of Firebase. Stands in for a client exchanging a custom token, returning an ID token that includes its developer claims.
	 * As in Firebase, this creates the user if they don't exist.
	 */
	async signInWithCustomToken(customToken)
	{
		const issued = this._customTokens.get(customToken);
		if(!issued)
			throw authError('argument-error', 'The custom token format is incorrect.');

		if(!this._users.has(issued.uid))
			await this.createUser({ uid: issued.uid });

		return this.#issueIdToken(this._users.get(issued.uid), issued.developerClaims ?? {}, 'custom');
	}

	/**
	 * Not part of Firebase. Clears all users, tokens and links, as the exported instance is shared between tests.
	 */
	reset()
	{
		this._users = new Map();
		this._idTokens = new Map();
		this._customTokens = new Map();
		this.actionLinks = [];
	}

	#issueIdToken(user, developerClaims, signInProvider)
	{
		const now = Math.floor(Date.now() / 1000);
		user.metadata.lastSignInTime = new Date(now * 1000).toUTCString();

		const decoded = {
			...copy(user.customClaims),
			...copy(developerClaims),
			aud: 'mock-project',
			iss: 'https://securetoken.google.com/mock-project',
			sub: user.uid,
			uid: user.uid,
			auth_time: now,
			iat: now,
			exp: now + 3600,
			firebase: { identities: {}, sign_in_provider: signInProvider }
		};

		if(user.email !== undefined)
		{
			decoded.email = user.email;
			decoded.email_verified = user.emailVerified;
		}

		if(user.displayName !== undefined)
			decoded.name = user.displayName;

		if(user.photoURL !== undefined)
			decoded.picture = user.photoURL;

		const token = `mock-id-token.${randomId()}`;
		this._idTokens.set(token, decoded);
		return token;
	}

	#generateLink(mode, email, actionCodeSettings)
	{
		const oobCode = randomId(32);
		const params = new URLSearchParams({ mode, oobCode, apiKey: 'mock-api-key', lang: 'en' });
		if(actionCodeSettings?.url)
			params.set('continueUrl', actionCodeSettings.url);

		const link = `https://mock-project.firebaseapp.com/__/auth/action?${params}`;
		this.actionLinks.push({ mode, email, oobCode, link });
		return link;
	}

	#getUser(uid)
	{
		const user = this._users.get(uid);
		if(!user)
			throw authError('user-not-found');
		return user;
	}

	#getUserByEmail(email, notFound = 'user-not-found')
	{
		for(const user of this._users.values())
			if(user.email === email)
				return user;

		throw authError(notFound);
	}

	/**
	 * Applies createUser/updateUser properties. In updateUser, null removes displayName, photoURL and phoneNumber.
	 */
	#applyProperties(user, properties)
	{
		if(properties === null || typeof properties !== 'object' || Array.isArray(properties))
			throw authError('argument-error', 'Properties argument must be a non-null object.');

		const { uid, email, emailVerified, displayName, photoURL, phoneNumber, password, disabled } = properties;

		if(email !== undefined)
		{
			const normalised = normaliseEmail(email);
			const owner = [...this._users.values()].find(u => u.email === normalised);
			if(owner && owner.uid !== (uid ?? user.uid))
				throw authError('email-already-exists');

			user.email = normalised;
		}

		if(emailVerified !== undefined)
		{
			if(typeof emailVerified !== 'boolean')
				throw authError('argument-error', 'The emailVerified field must be a boolean.');
			user.emailVerified = emailVerified;
		}

		if(displayName !== undefined)
		{
			if(displayName !== null && typeof displayName !== 'string')
				throw authError('invalid-display-name');
			user.displayName = displayName ?? undefined;
		}

		if(photoURL !== undefined)
		{
			if(photoURL !== null && (typeof photoURL !== 'string' || !URL.canParse(photoURL)))
				throw authError('invalid-photo-url');
			user.photoURL = photoURL ?? undefined;
		}

		if(phoneNumber !== undefined)
		{
			if(phoneNumber !== null && (typeof phoneNumber !== 'string' || !/^\+[1-9]\d{1,14}$/.test(phoneNumber)))
				throw authError('argument-error', 'The phone number must be a non-empty E.164 standard compliant identifier string.');
			user.phoneNumber = phoneNumber ?? undefined;
		}

		if(password !== undefined)
		{
			if(typeof password !== 'string' || password.length < 6)
				throw authError('invalid-password');
			user.password = password;
		}

		if(disabled !== undefined)
		{
			if(typeof disabled !== 'boolean')
				throw authError('argument-error', 'The disabled field must be a boolean.');
			user.disabled = disabled;
		}

		user.providerData = [
			...(user.email !== undefined && user.password !== undefined ? [{ uid: user.email, email: user.email, providerId: 'password' }] : []),
			...(user.phoneNumber !== undefined ? [{ uid: user.phoneNumber, phoneNumber: user.phoneNumber, providerId: 'phone' }] : [])
		];
	}
}

const auth = new AuthMock();
export default auth;

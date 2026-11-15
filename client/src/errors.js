/**
 * Explanations for Firebase error codes whose messages don't say what went wrong or what to do.
 * Firestore codes are unprefixed; Auth, Functions and Storage codes are prefixed with their service.
 */
const explanations = {
	// Firestore https://firebase.google.com/docs/reference/js/firestore_.firestoreerrorcode
	'cancelled': 'The operation was cancelled, usually because a listener was unsubscribed or the page navigated away',
	'unknown': 'Firestore failed for an unknown reason, often a network or browser extension problem',
	'invalid-argument': 'Firestore rejected the request as invalid, e.g. an undefined field value, more than 30 values in an \'in\' query, or an invalid document path',
	'deadline-exceeded': 'Firestore didn\'t respond in time, usually because of a slow connection or a large query',
	'not-found': 'The document doesn\'t exist',
	'already-exists': 'The document already exists',
	'permission-denied': 'Firestore security rules denied the request. Check the user is signed in with the expected claims, the rules for this path, and that queries filter on the fields the rules check',
	'resource-exhausted': 'A Firestore quota or rate limit was exceeded',
	'failed-precondition': 'Firestore can\'t run this request in its current state, usually because a query needs an index (see the link), or offline persistence is enabled in another tab',
	'aborted': 'The operation was aborted, usually because a transaction conflicted with another write. Retry it',
	'out-of-range': 'A value was outside the allowed range, e.g. a limit or cursor',
	'unimplemented': 'This operation isn\'t supported by this version of Firestore or the emulator',
	'internal': 'Firestore had an internal error. Retry, and if it persists, check the Firebase status page',
	'unavailable': 'Firestore is unreachable, usually because the client is offline. It will retry when it reconnects',
	'data-loss': 'Firestore reported unrecoverable data loss or corruption',
	'unauthenticated': 'The request has no valid credentials. The user may need to sign in again',

	// Auth https://firebase.google.com/docs/reference/js/auth#autherrorcodes
	'auth/network-request-failed': 'Couldn\'t reach Firebase Auth, usually because the client is offline, or an ad blocker or firewall blocked the request',
	'auth/too-many-requests': 'Firebase Auth temporarily blocked requests from this device after too many attempts. Wait and try again, or reset the password',
	'auth/requires-recent-login': 'This change needs the user to have signed in recently. Ask them to sign in again, then retry',
	'auth/user-token-expired': 'The user\'s session has expired or been revoked, e.g. after their password or email changed. They need to sign in again',
	'auth/invalid-credential': 'The email, password or sign in provider credential is wrong or has expired',
	'auth/invalid-login-credentials': 'The email or password is wrong',
	'auth/user-disabled': 'This account has been disabled',
	'auth/popup-blocked': 'The browser blocked the sign in popup. Allow popups for this site, or use redirect sign in',
	'auth/popup-closed-by-user': 'The sign in popup was closed before signing in finished',
	'auth/cancelled-popup-request': 'Another sign in popup was opened, cancelling this one',
	'auth/unauthorized-domain': 'This domain isn\'t authorised for sign in. Add it under Authentication > Settings > Authorised domains',
	'auth/operation-not-allowed': 'This sign in method isn\'t enabled for the project',
	'auth/invalid-action-code': 'The link is invalid, has already been used, or has expired. Request a new one',
	'auth/expired-action-code': 'The link has expired. Request a new one',
	'auth/quota-exceeded': 'A Firebase Auth quota was exceeded, e.g. emails or SMS sent',
	'auth/internal-error': 'Firebase Auth had an internal error, often a misconfigured provider or a blocking function that threw',
	'auth/web-storage-unsupported': 'The browser has storage disabled, e.g. third party cookies blocked or private browsing, so the session can\'t be kept',

	// Functions https://firebase.google.com/docs/reference/js/functions#functionserrorcode
	'functions/internal': 'The function failed without a specific error. It may have thrown, timed out, not be deployed in this region, or the request was blocked (e.g. CORS). Check the function\'s logs',
	'functions/not-found': 'The function doesn\'t exist. Check it\'s deployed, and the name and region',
	'functions/unauthenticated': 'The function requires a signed in user',
	'functions/permission-denied': 'The function refused the request, e.g. because of App Check or its own authorisation',
	'functions/deadline-exceeded': 'The function didn\'t respond before the client\'s timeout',
	'functions/unavailable': 'The function couldn\'t be reached, usually because the client is offline or the function is overloaded or starting up',
	'functions/resource-exhausted': 'The function hit a quota or its maximum number of instances',
	'functions/cancelled': 'The function call was cancelled',
	'functions/unknown': 'The function failed for an unknown reason. Check the function\'s logs',

	// Storage https://firebase.google.com/docs/storage/web/handle-errors
	'storage/unauthorized': 'Storage security rules denied the request',
	'storage/unauthenticated': 'Storage requires a signed in user for this request',
	'storage/object-not-found': 'The file doesn\'t exist',
	'storage/quota-exceeded': 'The Storage quota was exceeded',
	'storage/retry-limit-exceeded': 'The upload or download kept failing and was abandoned, usually because of a poor connection',
	'storage/canceled': 'The upload or download was cancelled',
	'storage/unknown': 'Storage failed for an unknown reason. Check the bucket\'s CORS configuration'
};

function isFirebaseError(e)
{
	return e?.name == 'FirebaseError' || (typeof e?.code == 'string' && typeof e?.message == 'string' && !!explanations[e.code]);
}

function detail(e)
{
	if(e.code == 'permission-denied')
	{
		if(e.message.includes(' for \'list\' @ '))
			return 'Denied listing a collection';
		if(e.message.includes(' for \'get\' @ '))
			return 'Denied getting a document';
	}

	// Firestore includes a link to create the missing index in the message
	let indexLink = e.message.match(/https:\/\/console\.firebase\.google\.com\S*indexes\S*/)?.[0];
	if(indexLink)
		return `Create the index at ${indexLink}`;

	return null;
}

/**
 * Wraps a Firebase error in one that says what was being done, what the error means and what to do about it.
 * The original error is the cause, and its code is kept so callers can still branch on it. Other errors are returned unchanged.
 * @param {Error} e The error Firebase threw
 * @param {string} message What was being done, e.g. `Failed to get ${path}`
 */
export function explainError(e, message)
{
	if(!isFirebaseError(e))
		return e;

	let parts = [message, explanations[e.code], detail(e), `${e.code}: ${e.message}`].filter(p => !!p);

	let error = new Error(parts.join('\n'), { cause: e });
	error.code = e.code;
	return error;
}

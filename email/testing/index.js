import { runDueTasks, travelMinutes } from '@trullock/firebase-functions/testing';
import { digestTimings } from '../src/index.js';

/**
 * For testing an app that sends emails with @trullock/firebase-email, alongside @trullock/firebase-functions/testing
 */

let messageCount = 0;

/**
 * Stands in for the SESClient given to configureEmails: records each command's input instead of sending it.
 * Call reset() between tests, e.g. by giving it to configureTesting's mocks.
 */
export const ses = {
	sent: [],
	failures: [],

	async send(command)
	{
		let failure = this.failures.shift();
		if(failure)
			throw failure;

		this.sent.push(command.input);
		return { MessageId: `mock-message-${++messageCount}` };
	},

	/**
	 * Makes the next send throw, as SES would when throttled or misconfigured
	 */
	failNext(error = new Error('Throttling: Maximum sending rate exceeded.'))
	{
		this.failures.push(error);
	},

	reset()
	{
		this.sent = [];
		this.failures = [];
	}
};

/**
 * Emails sent to an address, oldest first, as { from, replyTo, subject, html, text }
 */
export function emailsTo(address)
{
	return ses.sent
		.filter(m => m.Destination.ToAddresses.includes(address))
		.map(m => ({ from: m.Source, replyTo: m.ReplyToAddresses, subject: m.Message.Subject.Data, html: m.Message.Body.Html.Data, text: m.Message.Body.Text.Data }));
}

/**
 * Sends the email digests that will be due once their recipients have been quiet long enough, as if that time had
 * passed, without moving the clock (so dates already worked out stay the same)
 */
export async function sendDigests()
{
	let { quietMinutes } = digestTimings();
	travelMinutes(quietMinutes);
	try
	{
		await runDueTasks();
	}
	finally
	{
		travelMinutes(-quietMinutes);
	}
}

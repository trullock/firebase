// Email mechanics: loading compiled email .vues, rendering and sending emails, running email handlers, and digests
// Sending: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/ses-examples-sending-email.html
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SendEmailCommand } from '@aws-sdk/client-ses';
import inlineCss from 'inline-css';
import { JSDOM } from 'jsdom';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { autoMapFromFirestore, autoMapToFirestore } from '@trullock/firebase-common';
import { environment, error, queueTask, registerTask, warn } from '@trullock/firebase-functions';
import { buildPaths } from '@trullock/firebase-build/paths';

let config = null;

/**
 * Configures the emails. Call it before sending any.
 * @param {object} opts
 * @param {object} opts.firestore where digests' held emails are kept
 * @param {{ send(command) }} opts.ses an SESClient
 * @param {object} [opts.build] the build's config (see @trullock/firebase-build), to find the compiled emails and the folder handlers are in.
 * Its root defaults to the working directory, as the build's does
 * @param {string} [opts.wrapper] the .vue every email body is rendered inside, by default wrapper.vue in the build's sourceDir
 * @param {string} [opts.digest] the .vue email handler that renders a digest, by default digest.vue in the build's sourceDir
 * @param {() => string} [opts.digestMode] 'on', 'off' (send immediately) or another of digestTimings' modes, by default getEmailDigestMode
 * @param {object} [opts.digestTimings] by mode, in minutes: a recipient's digest is sent quietMinutes after the last email held
 * for it, but no later than maxWaitMinutes after the first. A mode with maxWaitMinutes 0 sends even one email as a digest.
 * @param {string} [opts.digestCollection] the Firestore collection held emails are kept in
 * @param {string} [opts.digestTask] the name of the task (see queueTask in @trullock/firebase-functions) that sends a recipient's digest when it's due
 */
export function configureEmails(opts)
{
	let build = opts.build ?? {};
	let { sourceDir } = buildPaths(build);

	config = {
		digestMode: getEmailDigestMode,
		digestTimings: {
			on: { quietMinutes: 15, maxWaitMinutes: 120 },
			quick: { quietMinutes: 1, maxWaitMinutes: 5 },
			forced: { quietMinutes: 0, maxWaitMinutes: 0 }
		},
		digestCollection: 'EmailDigestItem',
		digestTask: 'emailDigest',
		...opts,
		build,
		sourceDir,
		wrapper: opts.wrapper ?? path.join(sourceDir, 'wrapper.vue'),
		digest: opts.digest ?? path.join(sourceDir, 'digest.vue')
	};

	registerTask(config.digestTask, sendEmailDigest);
}

/**
 * How activity notifications are digested, from EMAIL_DIGESTS, e.g. set in .env.local to try them in dev:
 * 'off' (the default) sends them immediately, 'on' holds them until their recipient has been quiet for 15 minutes, 'quick' for 1 minute, 'forced'
 * sends each straight away as a digest, even on its own, to try the digest's rendering
 */
export function getEmailDigestMode()
{
	let modes = [...Object.keys(configured().digestTimings), 'off'];
	let mode = process.env.EMAIL_DIGESTS || 'off';
	if(!modes.includes(mode))
		throw new Error(`EMAIL_DIGESTS must be one of ${modes.join(', ')}, not '${mode}'`);

	return mode;
}

function configured()
{
	if(!config)
		throw new Error('configureEmails has not been called');
	return config;
}

/**
 * Imports an email .vue's compiled module: its <script>'s exports, plus ssrRender from its <template>
 */
export async function loadEmail(vuePath)
{
	let compiled = buildPaths(configured().build).compiled(vuePath);
	try
	{
		return await import(pathToFileURL(compiled));
	}
	catch(err)
	{
		if(!fs.existsSync(compiled))
			throw new Error(`${vuePath} hasn't been built to ${compiled}`, { cause: err });
		throw err;
	}
}

// templates are indented to match their markup, which shouldn't show in a text email
function unindent(text)
{
	return text.replace(/^[ \t]+|[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Sends an email, throwing if it fails so callers such as tasks can retry. Resolves to the message id.
 * In dev, where the AWS user may not have permission to send, resolves to null instead.
 */
export async function sendEmail(contentHtml, contentText, to, subject, source, tags, replyTos){

	tags = tags || [];
	tags.push({ Name: 'env', Value: environment() })

	let command = new SendEmailCommand({
		Destination: {
			ToAddresses: Array.isArray(to) ? to : [ to ]
		},
		Message: {
			Body: {
				Html: {
					Charset: "UTF-8",
					Data: contentHtml
				},
				Text: {
					Charset: "UTF-8",
					Data: contentText
				}
			},
			Subject: {
				Charset: "UTF-8",
				Data: subject
			},
		},
		Source: source,
		ReplyToAddresses: replyTos ?? [],
		Tags: tags
	});
	
	try
	{
		let result = await configured().ses.send(command);
		return result.MessageId;
	}
	catch (err)
	{
		if(!err?.message?.includes("not authorized to perform 'ses:SendEmail'"))
			throw err;

		warn(`Not authorized to perform 'ses:SendEmail' to ${to}`);
		return null
	}
}

// Vue's SSR escapes text as HTML, which a text email shouldn't be. These are the only entities it produces
function decodeVueEntities(text)
{
	return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
}

async function render(ssrRender, data)
{
	let html = await renderToString(createSSRApp({ data: () => data, ssrRender }));
	return html.replaceAll(/<\/?template>/g, '').replace(/<!--\[-->|<!--\]-->|<!---->/g, '');
}

/**
 * Renders an email's body inside the wrapper .vue, whose script provides defaults for what the email leaves out.
 * @param {{ to?, subject, data?, source?, replyTos? }} email
 * @param {{ html: string, text?: string }} body
 * @returns {{ html, text, data }} the rendered email, and the data the wrapper rendered it with (including the source and replyTos to send it with)
 */
export async function renderEmail(email, body)
{
	let wrapper = await loadEmail(configured().wrapper);
	let defaults = await wrapper.default();

	let data = {
		...defaults,
		to: email.to,
		subject: email.subject,
		source: email.source ?? defaults.source,
		replyTos: email.replyTos ?? defaults.replyTos,
		data: { ...defaults.data, ...email.data }
	};

	let html = await render(wrapper.ssrRender, { ...data, mode: 'html', body: body.html });
	let inlined = await inlineCss(html, {
		url: '/',
		preserveMediaQueries: true
	});

	// handle SES tags
	let dom = new JSDOM(inlined);
	let $as = [...dom.window.document.querySelectorAll('a')];
	$as.forEach(($a, i) => {
		let tags = $a.getAttribute('ses:tags') || ''
		if(tags.length)
			tags += ','
		tags += 'link:' + i
		$a.setAttribute('ses:tags', tags)
	});

	let text = await render(wrapper.ssrRender, { ...data, mode: 'text', body: body.text ?? '' });

	return {
		html: `<!DOCTYPE html>\n${dom.window.document.documentElement.outerHTML}`,
		text: unindent(decodeVueEntities(text)),
		data
	};
}

/**
 * Renders an email handler's email body with renderBody (a compiled template's ssrRender) in the given modes, without
 * wrapper.vue, e.g. its digest-html and digest-text blocks. The wrapper's default data (e.g. host) is the default for the body too.
 * @returns {{ html, text }}
 */
export async function renderVueEmailBody(renderBody, email, modes = { html: 'html', text: 'text' })
{
	let defaults = await (await loadEmail(configured().wrapper)).default();
	email = { ...email, data: { ...defaults.data, ...email.data } };

	return {
		html: await render(renderBody, { ...email, mode: modes.html }),
		text: unindent(decodeVueEntities(await render(renderBody, { ...email, mode: modes.text })))
	};
}

/**
 * Renders an email handler's email: its body with renderBody (a compiled template's ssrRender), inside wrapper.vue.
 * The wrapper's default data (e.g. host) is the default for the body too.
 */
export async function renderVueEmail(renderBody, email)
{
	let defaults = await (await loadEmail(configured().wrapper)).default();
	email = { ...email, data: { ...defaults.data, ...email.data } };

	return renderEmail(email, {
		html: await render(renderBody, { ...email, mode: 'html' }),
		text: await render(renderBody, { ...email, mode: 'text' })
	});
}

export function digestTimings()
{
	let { digestTimings, digestMode } = configured();
	let mode = digestMode();
	if(!digestTimings[mode])
		throw new Error(`No digest timings for the mode '${mode}'`);
	return digestTimings[mode];
}

const digestMode = () => configured().digestMode();
// a digest is due straight away, so even one email is sent as a digest
const forced = () => digestTimings().maxWaitMinutes == 0;

/**
 * Runs an email handler: a .vue whose <script> default exports async function(event), returning the emails to send as
 * { to, subject, data, source?, tags?, replyTos? } (or an array of them, or null to send nothing), and whose <template>
 * renders each email's body. Bodies are rendered inside the wrapper .vue.
 * A handler whose <script> also exports `digestable = true` has its emails held for each recipient's next digest instead,
 * so its <template> also renders the email's block of the digest in the modes 'digest-html' and 'digest-text'.
 */
export async function runEmailHandler(handlerPath, e)
{
	let { module, emails } = await buildEmails(handlerPath, e);

	if(module.digestable === true && digestMode() != 'off')
		await holdForDigests(handlerPath, e, emails);
	else
		await sendEmails(module, emails, handlerPath, e);
}

export async function buildEmails(handlerPath, e)
{
	let module = await loadEmail(handlerPath);
	let emails = await module.default(e);

	// its legitimate to return null, this means dont handle the event/send any emails
	return { module, emails: emails == null ? [] : [emails].flat() };
}

/**
 * A failure sending one email is logged, and doesn't stop the others. If every email fails, it throws so the task is
 * retried, as nothing has been sent that a retry would send twice.
 */
async function sendEmails(module, emails, handlerPath, e)
{
	let failures = [];

	for(let email of emails)
	{
		try
		{
			let rendered = await renderVueEmail(module.ssrRender, email);
			await sendEmail(rendered.html, rendered.text, email.to, email.subject, rendered.data.source, email.tags, rendered.data.replyTos);
		}
		catch(err)
		{
			error('Error sending email', { error: err, handlerPath, e, email });
			failures.push(err);
		}
	}

	if(failures.length && failures.length == emails.length)
		throw new AggregateError(failures, `Failed to send any of the emails from ${handlerPath}`);
}

const heldEmail = id => configured().firestore.doc(`${configured().digestCollection}/${id}`);
const minutesAfter = (time, minutes) => time.valueOf() + minutes * 60 * 1000;

/**
 * Holds the handler and event for each recipient, to run the handler again when their digest is sent, and queues a task
 * for when their digest is then due. A task's time can't be changed, so each held email queues its own, and one that
 * runs before the digest is due, as a later email has moved it, does nothing.
 */
async function holdForDigests(handlerPath, e, emails)
{
	let handler = path.relative(configured().sourceDir, handlerPath).split(path.sep).join('/');
	let event = JSON.stringify(autoMapToFirestore(e));

	for(let to of new Set(emails.map(email => email.to.toLowerCase())))
	{
		// the same when this task is retried, so a retry replaces what it held rather than duplicating it
		let id = createHash('sha256').update(`${handler}\n${event}\n${to}`).digest('hex');
		await heldEmail(id).set(autoMapToFirestore({ to, handler, event, addedOn: Date.now() }));

		let due = dueOn(await heldFor(to));
		await queueTask(configured().digestTask, { to }, due);
	}
}

async function heldFor(to = null)
{
	let held = configured().firestore.collection(configured().digestCollection);
	let snap = await (to ? held.where('to', '==', to) : held).get();

	return snap.docs.map(d => {
		let { handler, event, ...item } = autoMapFromFirestore(d.data());
		return { ...item, id: d.id, stored: d.data(), handlerPath: path.join(configured().sourceDir, handler), event: autoMapFromFirestore(JSON.parse(event)) };
	}).sort((a, b) => a.addedOn - b.addedOn);
}

function dueOn(items)
{
	let { quietMinutes, maxWaitMinutes } = digestTimings();
	return new Date(Math.min(minutesAfter(items.at(-1).addedOn, quietMinutes), minutesAfter(items[0].addedOn, maxWaitMinutes)));
}

/**
 * The task queued when an email is held, for when its recipient's digest is then due. Sends the digest if it's still
 * due: if a later email has moved it, that email's task sends it.
 */
export async function sendEmailDigest({ to })
{
	let items = await heldFor(to);
	if(items.length && dueOn(items) <= Date.now())
		await claimAndSend(to, items);
}

/**
 * Sends each recipient's digest that's due. Run hourly, it sends any whose task gave up, e.g. during a long outage
 */
export async function sendDueDigests()
{
	for(let [to, items] of Map.groupBy(await heldFor(), i => i.to))
	{
		if(dueOn(items) > Date.now())
			continue;

		try
		{
			await claimAndSend(to, items);
		}
		catch(err)
		{
			error('Error sending email digest', { error: err, to });
		}
	}
}

/**
 * Deletes the held emails before sending them, failing if any has gone, so only one of the tasks that could find the
 * same digest due (which can run late, or together) sends it. One is sent as it would have been without digests, and
 * several as one digest (the digest .vue). If sending fails they're put back, and it throws so it's retried.
 */
async function claimAndSend(to, items)
{
	let claim = configured().firestore.batch();
	items.forEach(item => claim.delete(heldEmail(item.id), { exists: true }));
	try
	{
		await claim.commit();
	}
	catch(err)
	{
		let held = new Set((await heldFor(to)).map(i => i.id));
		if(items.some(i => !held.has(i.id)))
			return;
		throw err;
	}

	try
	{
		if(items.length == 1 && !forced())
		{
			let [{ handlerPath, event }] = items;
			let { module, emails } = await buildEmails(handlerPath, event);
			await sendEmails(module, emails.filter(email => email.to.toLowerCase() == to), handlerPath, event);
		}
		else
			await runEmailHandler(configured().digest, { to, items });
	}
	catch(err)
	{
		let putBack = configured().firestore.batch();
		items.forEach(item => putBack.set(heldEmail(item.id), item.stored));
		await putBack.commit();
		throw err;
	}
}

// https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/ses-examples-sending-email.html
import { SendEmailCommand } from "@aws-sdk/client-ses";
import inlineCss from 'inline-css'
import { JSDOM } from 'jsdom'
import { environment, error, warn } from "@trullock/firebase-functions";
import { SESClient } from "@aws-sdk/client-ses";
import { fromEnv } from "@aws-sdk/credential-providers";
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'

let client = null;

function sesClient() {
	if(!client)
	{
		try
		{
			client = new SESClient({ 
				region: 'eu-west-1',
				credentials: fromEnv()
			});
		}
		catch(e)
		{
			error(`Failed to create SES Client: ${e}`, { error: e })
		}
	}

	return client;
}

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
		ReplyToAddresses: replyTos,
		Tags: tags
	});
	
	try
	{
		let result = await sesClient().send(command);
		// log(`Email sent to ${to}`, result);
		return result.MessageId;
	}
	catch (err)
	{
		if(err.message.indexOf("Developer' is not authorized to perform 'ses:SendEmail'"))
			warn(`Developer is not authorized to perform 'ses:SendEmail' to ${to}`);
		else
			error(`Error sending email to ${to}`, {error: err});
		return null
	}
}

export async function renderVueEmail(wrapperModule, renderBody, data)
{
	// render html version
	data.mode = 'html'
	const contentsApp = createSSRApp({ data: () => data, ssrRender: renderBody });
	contentsApp.config.compilerOptions.comments = true;
	contentsApp.config.compilerOptions.whitespace = 'preserve';
	const contents_html = await renderToString(contentsApp);

	// render html wrapper
	const wrapperData = await wrapperModule.default();
	
	wrapperData.to = data.to
	wrapperData.subject = data.subject
	wrapperData.source = data.source;
	wrapperData.replyTos = data.replyTos;

	wrapperData.mode = 'html';
	wrapperData.data = Object.assign(wrapperData.data, data.data);
	wrapperData.body = contents_html;
	const wrapperApp = createSSRApp({ data: () => wrapperData, ssrRender: wrapperModule.ssrRender });
	wrapperApp.config.compilerOptions.comments = true;
	wrapperApp.config.compilerOptions.whitespace = 'preserve';
	let html = await renderToString(wrapperApp);
	html = html.replaceAll(/<\/?template>/g, '').replace(/<!--\[-->|<!--\]-->|<!---->/g, '');
	
	// inline CSS into the HTML
	let inlined = await inlineCss(html, {
		url: '/',
		preserveMediaQueries: true
	})

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

	// render text version
	
	data.mode = 'text'
	let contents_text = await renderToString(contentsApp);
	contents_text = contents_text.replaceAll(/<\/?template>/g, '').replace(/<!--\[-->|<!--\]-->|<!---->/g, '');
	wrapperData.body = contents_text;
	wrapperData.mode = 'text';
	let text = await renderToString(wrapperApp);
	text = text.replaceAll(/<\/?template>/g, '').replace(/<!--\[-->|<!--\]-->|<!---->/g, '');

	delete wrapperData.mode;
	delete wrapperData.body;

	return {
		html: `<!DOCTYPE html>\n${dom.window.document.documentElement.outerHTML}`,
		text: text,
		data: wrapperData
	};
}
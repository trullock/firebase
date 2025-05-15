
import { getAuth } from 'firebase-admin/auth'
import User from '../../user.js';
import { domainCommand } from '../../../../src/function-helpers.js';
import { z } from 'zod';

const schema = z.object({
	name: z.string()
})

export default domainCommand(schema, async (ctx, command) => {

	let user = User.create(ctx, ctx.issuingUserId, number, command.name, ctx.auth.token.email.toLowerCase(), photoUrl, realAvatar, ctx.auth.token.email_verified);
	await saveUser(user);

	await getAuth().setCustomUserClaims(ctx.issuingUserId, {
		isAdmin: user.isAdmin
	});
});


import { getFunctions, httpsCallable } from 'firebase/functions'
import { autoMapFromFirestore, autoMapToFirestore } from '@trullock/firebase-common';

let p = new Proxy({}, {
	get: function(target, prop, receiver)
	{
		let fns = getFunctions(undefined, 'europe-west1');

		if(prop == 'warmUp')
		{
			return new Proxy({}, {
				get: function(target, prop, receiver)
				{
					return function(data) {
						try
						{
							httpsCallable(fns, prop)({ warmUp: true });
						}
						catch(e)
						{
							console.error(`Failed to warm up function ${prop}`, e);
						}
					};
				}
			});		
		}
		return async function(data, opts) {
			try
			{
				let serialzised = autoMapToFirestore(data);
				let result = await httpsCallable(fns, prop, opts || { })(serialzised);
				let retval = autoMapFromFirestore(result.data) || {};
				if(retval.success == undefined)
					retval.success = true;
				return retval;
			}
			catch(e)
			{
				return { 
					success: false,
					error: e
				}
			}
		};
	}
});

export const functions = p;
import { getFirestore, doc, getDoc, collection, getDocs, query, onSnapshot, where, documentId } from 'firebase/firestore'
import { convertFromFirestore, chunk, firestorePath } from '@trullock/firebase-common'

/**
 * Gets a projection by its path
 * @param {string} pathSegments Path to the projection to listen to
 * @param {boolean} throwOnNonExist Throws if the data doesnt exist
 * @returns 
 */
export async function getProjection(pathSegments, throwOnNonExist = true)
{
	let db = getFirestore();
	let path = firestorePath(pathSegments);
	let ref = doc(db, path);
	
	let snap = null;
	try
	{
		snap = await getDoc(ref);
	}
	catch(e)
	{
		throw explainError(e, `Failed to get ${path}`);
	}

	if(!snap.exists())
	{
		if(throwOnNonExist)
			throw new Error(`Document '${path}' not found`)
		
		return null;
	}

	let data = convertFromFirestore(snap.data());
	return data;
}

/**
 * Get all projections in a collection
 * @param {[string]} pathSegments Path segments to the collection
 * @returns 
 */
export async function getAllProjectionsInCollection(pathSegments)
{
	let db = getFirestore();
	let path = firestorePath(pathSegments);
	let ref = collection(db, path);
	let snap = null;
	try
	{
		snap = await getDocs(ref)
	}
	catch(e)
	{
		throw explainError(e, `Failed to get ${path}`);
	}
	return snap.docs.map(d => convertFromFirestore(d.data()));
}

export async function findProjection(pathSegments, constraints)
{
	let db = getFirestore();
	let path = firestorePath(pathSegments);
	let ref = collection(db, path);
	let q = Array.isArray(constraints) ? query(ref, ...constraints) : query(ref, constraints);

	let snap = null;
	try
	{
		snap = await getDocs(q);
	}
	catch(e)
	{
		throw explainError(e, `Failed to query ${path}`);
	}

	if(snap.docs.length == 1)
		return convertFromFirestore(snap.docs[0].data());
	return null;
}

export async function findProjections(pathSegments, constraints)
{
	let db = getFirestore();
	let path = firestorePath(pathSegments);
	let ref = collection(db, path);
	let q = Array.isArray(constraints) ? query(ref, ...constraints) : query(ref, constraints);
	let snap = null;
	try
	{
		snap = await getDocs(q);
	}
	catch(e)
	{
		throw explainError(e, `Failed to query ${path}`);
	}

	let results = snap.docs.map(result => convertFromFirestore(result.data()))
	return results;
}

export async function getProjectionsById(pathSegments, ids)
{
	if(ids.length == 0)
		return [];

	let db = getFirestore();
	let path = firestorePath(pathSegments);
	let ref = collection(db, path);

	let idChunks = chunk(ids, 10);
	
	// TODO: try catch
	let chunkedSnapshots = await Promise.all(idChunks.map(ids => getDocs(query(ref, where(documentId(), 'in', ids)))))
	let projections = chunkedSnapshots.flatMap(snap => snap.docs.map(doc => convertFromFirestore(doc.data())))
	return projections;
}

export async function listenToSingletonProjection(type, callback)
{
	return listenToProjection(`singletons/${type.name}`, callback)
}

/**
 * Listens to changes on a single projection
 * @param {string} pathSegments Path to the projection to listen to
 * @param {function} callback callback(projection, isFirstCall)
 * @param {boolean} rejectOnNonExist Reject the returned promise if the data doesnt exist
 * @returns 
 */
export async function listenToProjection(pathSegments, callback, rejectOnNonExist = true)
{
	let db = getFirestore();
	let path = firestorePath(pathSegments);
	let ref = doc(db, path);
	let firstCall = true;
	return new Promise((resolve, reject) => {
		const unsubscribe = onSnapshot(ref, async doc => {
			let data = convertFromFirestore(doc.data())

			if(rejectOnNonExist && firstCall && !data)
			{
				reject(new Error(`Document '${path}' not found`));
				unsubscribe && unsubscribe();
				return;
			}

			try
			{
				await Promise.resolve(callback(data, firstCall));
			}
			catch(e)
			{
				reject(explainError(e, `Listening to document '${path}'`));
			}

			if(firstCall)
			{
				resolve(unsubscribe);
				firstCall = false;
			}
		}, e => {
			reject(explainError(e, `Listening to document '${path}'`));
		});
	});
}

/**
 * Listen to a collection for changes
 * @param {array} pathSegments The path of the collection to listen to
 * @param {array} array The array to maintain with changes. The objects in the array must have a `.id` property which contains the document reference id
 * @param {function} callback callback(array, changes)
 * @returns 
 */
export async function listenForProjections(pathSegments, array, callback)
{
	let db = getFirestore();
	let ref = collection(db, firestorePath(pathSegments));

	let firstCall = true;
	return new Promise((resolve, reject) => {
		const unsubscribe = onSnapshot(ref, async snapshot => {
			let changes = snapshot.docChanges();
			changes.forEach(change => {
				const { newIndex, oldIndex, doc, type } = change
				if (type === 'added') {
					array.splice(newIndex, 0, convertFromFirestore(doc.data()))
					// if we want to handle references we would do it here
				} else if (type === 'modified') {
					let newData = convertFromFirestore(doc.data());
					// we have to do this in case the array has been sorted outside of our control
					let prevIndex = array.findIndex(a => a.id == doc.ref.id)
					// remove the old one first
					array.splice(prevIndex, 1)
					// if we want to handle references we would have to unsubscribe
					// from old references' listeners and subscribe to the new ones
					// if we have been sorted outside our control, newIndex will unlikely be correct, so you'll need to use the callback to re-sort
					array.splice(newIndex, 0, newData)
				} else if (type === 'removed') {
					// we have to do this in case the array has been sorted outside of our control
					let index = array.findIndex(a => a.id == doc.ref.id)
					array.splice(index, 1)
					// if we want to handle references we need to unsubscribe
					// from old references
				}
			});

			if(callback)
			{
				try
				{
					await Promise.resolve(callback(array, changes));
				}
				catch(e)
				{
					reject(explainError(e, `Listening to collection ${ref}`))
				}
			}

			if(firstCall)
			{
				resolve(unsubscribe);
				firstCall = false;
			}
		}, e => {
			reject(explainError(e, `Listening to collection ${ref}`))
		});
	});
}

export async function listenForFoundProjections(pathSegments, constraints, array, callback)
{
	let db = getFirestore();
	let ref = collection(db, firestorePath(pathSegments));
	let q = Array.isArray(constraints) ? query(ref, ...constraints) : query(ref, constraints);

	let firstCall = true;
	return new Promise((resolve, reject) => {
		const unsubscribe = onSnapshot(q, async snapshot => {
			let changes = snapshot.docChanges();
			changes.forEach(change => {
				const { newIndex, oldIndex, doc, type } = change
				if (type === 'added') {
					array.splice(newIndex, 0, convertFromFirestore(doc.data()))
					// if we want to handle references we would do it here
				} else if (type === 'modified') {
					// remove the old one first
					array.splice(oldIndex, 1)
					// if we want to handle references we would have to unsubscribe
					// from old references' listeners and subscribe to the new ones
					array.splice(newIndex, 0, convertFromFirestore(doc.data()))
				} else if (type === 'removed') {
					array.splice(oldIndex, 1)
					// if we want to handle references we need to unsubscribe
					// from old references
				}
			});
			if(callback)
			{
				try
				{
					await Promise.resolve(callback(array, changes));
				}
				catch(e)
				{
					reject(explainError(e, `Listening to collection ${ref}`))
				}
			}

			if(firstCall)
			{
				resolve(unsubscribe);
				firstCall = false;
			}
		}, e => {
			reject(explainError(e, `Listening to collection ${ref}`))
		});
	});
}


export function explainError(e, message)
{
	if(e.name == 'FirebaseError')
	{
		if(e.code == 'permission-denied')
		{
			if(e.message.indexOf(' for \'list\' @ ') > -1)
				return new Error('Firestore permissions error when getting collection\n' + message);

			if(e.message.indexOf(' for \'get\' @ ') > -1)
				return new Error('Firestore permissions error when getting document\n' + message);

			return new Error('Firestore permissions error: ' + e.message + '\n' + message);
		}
	}

	return e;
}
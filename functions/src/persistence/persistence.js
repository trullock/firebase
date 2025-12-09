import { publish } from '@trullock/pubsub'
import { error } from '../logging/logger.js';
import { convertFromFirestore, convertToFirestore, firestorePath } from '@trullock/firebase-common';

export async function getEntity(firestore, pathSegments, ctx)
{
	let entity = await getDocument(firestore, pathSegments);
	entity.setContext(ctx);
	return entity;
}

export async function getAllEntities(firestore, pathSegments, ctx)
{
	let snap = await firestore.collection(firestorePath(pathSegments)).get();
	let results = snap.docs.map(d => {
		let doc = d.data();
		let entity = convertFromFirestore(doc);
		entity.setContext(ctx);
		return entity;
	})
	return results;
}

let recursePromises = function(results)
{
	results.forEach(r => {
		if(r.status == 'rejected')
			error(r.reason)
		
		if(Array.isArray(r.value))
			recursePromises(r.value);
	})
}

export async function saveEntity(firestore, entity, pathSegments)
{
	if(!entity.isDirty)
		return;

	const events = entity.commitEvents();
	const batch = firestore.batch();

	let path = firestorePath(pathSegments);

	let converted = convertToFirestore(entity);
	batch.set(firestore.doc(path), converted);
	
	for(let i = 0; i < events.length; i++)
		batch.create(firestore.doc(`${path}/${entity.constructor.name}Events/${events[i].sequence}`), convertToFirestore(events[i]));
	
	await batch.commit();

	for(let i = 0; i < events.length; i++)
	{
		// dont parellelise the publishing of different events, the 2nd event could depend on the side-effects of the first
		let results = await publish(events[i].type, events[i].data);
		recursePromises(results);
	}
}

export function deleteEntity(firestore, pathSegments, deleteChildren)
{
	let path = firestorePath(pathSegments);
	if(deleteChildren)
		return firestore.doc(path).deleteRecursive();
	else
		return firestore.doc(path).delete();
}

export async function getProjection(firestore, pathSegments)
{
	return getDocument(firestore, pathSegments);
}

async function getDocument(firestore, pathSegments)
{
	let path = firestorePath(pathSegments);
	let snap = await firestore.doc(path).get();
	if(!snap.exists)
		return null;
	let doc = snap.data();
	let converted = convertFromFirestore(doc);
	return converted;
}

export async function getSingletonProjection(firestore, type)
{
	let path = `singletons/${type.name}`;
	let snap = await firestore.doc(path).get();
	// To allow defaulting an empty db
	let doc = snap.exists ? snap.data() : convertToFirestore(new type());
	let converted = convertFromFirestore(doc);
	return converted;
}

export async function queryProjections(firestore, pathSegments, filter)
{
	let snap = await filter(firestore.collection(firestorePath(pathSegments))).get();
	let results = snap.docs.map(d => {
		let doc = d.data();
		let converted = convertFromFirestore(doc);
		return converted;
	})
	return results;
}

export async function deleteQuery(firestore, pathSegments, filter)
{
	let snap = await filter(firestore.collection(firestorePath(pathSegments))).get();
	
	let batch = firestore.batch();
	snap.docs.forEach(d => batch.delete(d.ref))
	return batch.commit();
}

export async function saveProjection(firestore, projection, pathSegments)
{
	let path = firestorePath(pathSegments);
	let converted = convertToFirestore(projection);
	await firestore.doc(path).set(converted);
}

export async function saveSingletonProjection(firestore, projection)
{
	let path = `singletons/${projection.constructor.name}`;
	let converted = convertToFirestore(projection);
	await firestore.doc(path).set(converted);
}

// export async function saveProjections(firestore, projections)
// {
// 	let batch = firestore.batch();
// 	for(var projection of projections)
// 	{
// 		let converted = convertToFirestore(projection);
// 		let path = `${projection.constructor.name}/${projection.id}`;
// 		let ref = firestore.doc(path);
// 		batch.set(ref, converted)
// 	}
// 	await batch.commit();
// }

export function deleteProjection(firestore, pathSegments, deleteChildren)
{
	let path = firestorePath(pathSegments);
	if(deleteChildren)
		return firestore.doc(path).deleteRecursive();
	else
		return firestore.doc(path).delete();
}

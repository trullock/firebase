/**
 * Chops an array into n sub arrays of maximum size Size
 * @param {array} array 
 * @param {number} size chunk size
 * @returns 
 */
export function chunk(array, size) {
	let chunks = [];
	let clone = array.slice();
	while(clone.length)
		chunks.push(clone.splice(0, size))
	return chunks;
}


export function firestorePath(pathSegments)
{
	if(typeof pathSegments == 'string')
		return pathSegments;

	let segemnts = pathSegments.map((a, i) => {
		if(i % 2 == 0)
			return a.name;
		return a;
	});

	return segemnts.join('/');
}
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











function getAllProtoProps(obj) {
	const props = [];
	let proto = Object.getPrototypeOf(obj);
	while (proto && proto !== Object.prototype)
		{
		Object.getOwnPropertyNames(proto)
			.filter(p => p != 'constructor')
			.forEach(p => props.push({
				name: p,
				descriptor: Object.getOwnPropertyDescriptor(proto, p)
			}));
		proto = Object.getPrototypeOf(proto);
	}
	return props
}

function getAllStaticProps(cls) {
	const props = []
	let current = cls;
	while (current && current !== Function.prototype)
	{
		let properties = Object.getOwnPropertyNames(current)
		properties = properties.filter(p => !['length', 'name', 'prototype'].includes(p))
		properties.forEach(p => props.push({
			name: p,
			descriptor: Object.getOwnPropertyDescriptor(current, p)
		}));
		current = Object.getPrototypeOf(current);
	}
	return props;
}

function getAllNonStaticProps(cls) {
	// TODO: can we extend cls with a class with a construction that doesnt call super() to get instance properties without actually "instantiating" the class?
	const instance = new cls();
			// tempted not to do this, as it requires instantiating the class, but it is the only way I can think of to get instance properties that are not declared in the constructor
	return Object.getOwnPropertyNames(instance).map(p => ({ name: p, descriptor: Object.getOwnPropertyDescriptor(instance, p) }))
		.concat(getAllProtoProps(instance))
}


export function Mixins(bases) {
	class Bases {
		constructor() {
			bases.forEach(base => Object.assign(this, new base()));
		}
	}
	bases.forEach(base => {
		let properties = getAllNonStaticProps(base);
		properties.forEach(prop => {
			Object.defineProperty(Bases.prototype, prop.name, prop.descriptor)
		})

		properties = getAllStaticProps(base);
		properties.forEach(prop => {
			Object.defineProperty(Bases, prop.name, prop.descriptor)
		})
	})
	return Bases;
}
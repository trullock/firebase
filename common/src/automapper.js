let classes = {}

let mappings = [];
/**
 * 
 * @param {function} toFirestore A function of the form (key: string, value: object/primitive) => object/primitive. Return a mapped value or undefined to fallback to default mapping
 * @param {function} fromFirestore A function of the form (key: string, value: object/primitive, dest: object) => object/primitive. Return a mapped value or undefined to fallback to default mapping
 */
export function registerMapping(toFirestore, fromFirestore)
{
	mappings.push({
		toFirestore,
		fromFirestore
	})
}

let migrations = []
/**
 * 
 * @param {function} shouldApply A function of the form ({ key: string, parent: object, value: object/primitive, destination: object, type: class }) => true/false. Return if the migration should apply or not
 * @param {function} apply A function of the form ({ key: string, parent: object, value: object/primitive, destination: object, type: class }) => object/primitive. Migrate the value. Return undefined to disregard the value.
 */
export function registerMigration(shouldApply, apply)
{
	migrations.push({
		shouldApply,
		apply
	})
}

function getClassMappingByType(type)
{
	for(let [key, value] of Object.entries(classes))
	{
		if(type == value.type)
		{
			return {
				name: key,
				type,
				getters: value.getters
			};
		}
	}

	throw new Error(`Could not serialize type ${type.name}. Did you call registerClassForPersistence() or registerMapping()?`);
}

function getClassMappingByName(name)
{
	return classes[name] || null
}

/**
 * Register a class with AutoMapper for persistence
 * @param {Class} type The type of the class
 * @param {Array} name O
 */
export function registerClassForPersistence(type, persistedGetters)
{
	return doRegisterClassForPersistence(type, null, null, persistedGetters || [])
}

function getAllStaticProps(type) {
    const props = [];
    let current = type;
    while (current && current !== Function.prototype)
		{
        Object.getOwnPropertyNames(current)
            .filter(p => !['length', 'name', 'prototype'].includes(p))
            .forEach(p => props.push({
				name: p,
				value: Object.getOwnPropertyDescriptor(current, p).value
			}));
			
        current = Object.getPrototypeOf(current);
    }
    return props;
}

function doRegisterClassForPersistence(type, name, parent, persistedGetters)
{
	let key = name ? name : type.name;
	if(parent)
		key = parent + '.' + name;

	classes[key] = {
		type,
		getters: persistedGetters.filter(pg => pg.type == type).map(pg => pg.property)
	};

	// static nested classes
	let props = getAllStaticProps(type);
	for(let prop of props)
	{
		if(prop.value?.toString()?.substr(0, 5) == 'class')
			doRegisterClassForPersistence(prop.value, prop.name, key, persistedGetters)
	}
}

/**
 * Converts an object into a firestore-storable format
 * @param {object} obj 
 * @param {function} converter Optional: conversion function
 * @returns 
 */
export function convertToFirestore(obj, converter)
{
	let converted = converter ? converter(obj) : autoMapToFirestore(obj);
	return converted;
}

/**
 * Converts an object from a firestore-storable format into an in-memory format
 * @param {object} obj A firestore object
 * @param {*} converter Optional: conversion function
 * @returns 
 */
export function convertFromFirestore(obj, converter)
{
	if(converter)
	{
		let converted = converter(obj);
		return converted;
	}

	let converted = autoMapFromFirestore(obj);
	return converted;
}

/**
 * Automatically maps an object into firestore format
 * @param {object} obj The object to map
 * @returns Firestore-friendly object
 */
export function autoMapToFirestore(obj)
{
	if(obj == null)
		return null;
	
	if(Array.isArray(obj))
		return obj.map(o => autoMapToFirestore(o));

	if(obj?.constructor == Object || typeof obj == 'object')
	{
		let retval = {};

		if(obj.constructor.toString()?.substr(0, 5) == 'class')
		{
			let mapping = getClassMappingByType(obj.constructor)
			retval._type = mapping.name

			for(let getter of mapping.getters)
			{
				let value = obj[getter];

				let mapped = false;
				for(let mapping of mappings)
				{
					let result = mapping.toFirestore(getter, value)
					if(result !== undefined)
					{
						retval[getter] = result;
						mapped = true;
						break;
					}
				}

				if(!mapped)
					retval[getter] = autoMapToFirestore(value);
			}
		}

		for(let [key, value] of Object.entries(obj))
		{
			let mapped = false;
			for(let mapping of mappings)
			{
				let result = mapping.toFirestore(key, value)
				if(result !== undefined)
				{
					retval[key] = result;
					mapped = true;
					break;
				}
			}

			if(!mapped)
				retval[key] = autoMapToFirestore(value);
		}
		return retval;
	}
	
	return obj;
}

/**
 * Automatically maps an object from firestore format
 * @param {object} obj 
 * @returns In-memory clean object
 */
export function autoMapFromFirestore(obj)
{
	if(obj == undefined)
		return undefined;
	
	if(obj == null)
		return null;

	// Handle Objects
	if(obj?.constructor == Object)
	{
		let dest = {};
		let mapping = null;

		// does this living here mean it cant be migrated?
		if(obj._type)
		{
			mapping = getClassMappingByName(obj._type)
			dest = new mapping.type();
		}

		for(let [key, value] of Object.entries(obj))
		{	
			let prop = {
				key,
				value,
				parent: obj,
				dest, 
				type: mapping?.type
			}

			for(let migration of migrations)
			{
				// shouldApply should not mutate prop object
				if(!migration.shouldApply(prop))
					continue;

				// the intention is for the migration to mutate the prop object
				migration.apply(prop);
			}

			if(prop.key == "_type")
				continue;

			if(mapping?.getters?.indexOf(prop.key) > -1)
				continue;

			let handled = false;
			for(let mapping of mappings)
			{
				let result = mapping.fromFirestore(prop.key, prop.value, prop.dest)
				if(result !== undefined)
				{
					prop.dest[prop.key] = result;
					handled = true;
					break;
				}
			}

			if(!handled)
			{
				let result = autoMapFromFirestore(prop.value);
				if(result != undefined)
					prop.dest[prop.key] = result;
			}
		}

		return dest;
	}

	// Handle Arrays
	if(Array.isArray(obj))
		return obj.map(autoMapFromFirestore);

	// Handle Primitives
	return obj;
}
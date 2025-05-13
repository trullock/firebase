let classes = {}

let mappings = [];
/**
 * 
 * @param {function} toFirestore A function of the form (key: string, value: object/primitive) => object/primitive. Return a mapped value or undefined to fallback to default mapping
 * @param {funciton} fromFirestore A function of the form (key: string, value: object/primitive) => object/primitive. Return a mapped value or undefined to fallback to default mapping
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
 * @param {function} shouldApply A function of the form (key: string, parent: object, value: object/primitive) => true/false. Return if the migration should apply or not
 * @param {function} apply A function of the form key: string, parent: object, value: object/primitive) => object/primitive. Migrate the value. Return undefined to disregard the value.
 */
export function registerMigration(shouldApply, apply)
{
	migrations.push({
		shouldApply,
		apply
	})
}

function serialiseClassName(type)
{
	for(let [key, value] of Object.entries(classes))
	{
		if(type == value)
			return key;
	}

	throw new Error(`Could not serialize type ${type.name}. Did you call registerClassForPersistence() or registerMapping()?`);
}

function deserialiseClassName(name)
{
	return classes[name] || null
}

/**
 * Register a class with AutoMapper for persistence
 * @param {Class} type The type of the class
 * @param {string} name Optional: The name of the class. Leave blank to use the class' name+namespace. Beware minifiers can mangle class names and create dev/prod inconsistencies/issues
 * @param {string} parent Optional: The name of the parent class, if present
 */
export function registerClassForPersistence(type, name, parent)
{
	let key = name ? name : type.name;
	if(parent)
		key = parent + '.' + name;

	classes[key] = type;

	// static nested classes
	for(let [k, value] of Object.entries(type))
	{
		if(value?.toString()?.substr(0, 5) == 'class')
			registerClassForPersistence(value, k, key)
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
			retval._type = serialiseClassName(obj.constructor)

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

		let type = null;

		if(obj._type)
		{
			type = deserialiseClassName(obj._type)
			
			try
			{
				dest = new type();
			}
			catch(e)
			{
				dest = {};
			}
		}

		for(let [key, value] of Object.entries(obj))
		{
			if(key == '_type')
				continue;
			
			for(let migration of migrations)
			{
				if(!migration.shouldApply(key, obj, value, dest, type))
					continue;

				value = migration.apply(key, obj, value, dest, type);
			}

			let handled = false;
			for(let mapping of mappings)
			{
				let result = mapping.fromFirestore(key, value)
				if(result !== undefined)
				{
					dest[key] = result;
					handled = true;
					break;
				}
			}

			if(!handled)
			{
				let result = autoMapFromFirestore(value);
				if(result != undefined)
					dest[key] = result;
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
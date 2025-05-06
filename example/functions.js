import { registerClassForPersistence, registerMapping, registerMigration } from "../src/index.js";
import MyClass from "./MyClass.js";

/////////////////////////////////////////////


// Registers all classes you want to be (de)serialised to/from firestore
registerClassForPersistence(MyClass);


/////////////////////////////////////////////


// Register custom (de)serialisation for Dates (which are properties on MyClass etc)
// If we dont do this, we dont know how to (de)serialise the Date and Saving will go pop
registerMapping((key, value) => {
    if(value instanceof Date)
        return value.toISOString();
    return undefined;
}, (key, value) => {
	// by convention we are going to call all Date properties "somethingOn", otherwise we dont know to apply this special deserialisation mapping
    if((key.substr(key.length - 2, 2) == 'On') && typeof value == 'string')
    {
        let date = new Date(Date.parse(value));
        return date;
    }
    return undefined;
})


/////////////////////////////////////////////


// Migrate MyClass.nombre to MyClass.name
registerMigration((key, parent, value, dest, type) => type == MyClass && key == 'nombre', (key, parent, value, dest, type) => {
	dest.name = value;
	// return undefined to delete the original (nombre) property and not map it across.
	// any other return value will get set into MyClass.nombre
	return undefined;
})


/////////////////////////////////////////////


// Import all event handlers - currently this has to be done manually
import './eventHandler.js'


/////////////////////////////////////////////

// All domain events have an `occurredOn`, this is set automatically using the nowFn, if you dont want the default, you can override it.
// The below is the default anyway, so you dont need this, but its shown here for completeness to show you how to override it
import { setNowFn } from "../src/utils";
setNowFn(() => new Date());

import test from "node:test";
import { autoMapFromFirestore, autoMapToFirestore, registerClassForPersistence } from "../src/automapper.js";
import assert from "node:assert";

class MyObj {
	get age() {
		return 18;
	}

	name = 'Mr Test'
	inner = new MyObj.MyInnerObj()


	static MyInnerObj = class {
		get height() {
			return 180;
		}

		size = 'Large'
	}
}


let myObj = new MyObj();

registerClassForPersistence(MyObj, [
	{
		type: MyObj.MyInnerObj,
		property: 'height'
	}
]);

let mapped = autoMapToFirestore(myObj);

test('should automap defined getters to Firebase', t => {
	assert.deepEqual(mapped, {
		_type: 'MyObj',
		name: 'Mr Test',
		inner: { _type: 'MyObj.MyInnerObj', height: 180, size: 'Large' }
	})
})

let unmapped = autoMapFromFirestore(mapped)

test('should ignore automap defined getters from Firebase', t => {
	assert.deepEqual(unmapped, myObj)
})

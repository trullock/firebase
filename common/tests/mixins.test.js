import test, { beforeEach } from "node:test";
import assert from "node:assert";
import { Mixins } from "../src/utils.js";

class Sequencer
{
	static sequence = [];

	static reset()
	{
		this.sequence = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
	}

	static next()
	{
		return this.sequence.shift();
	}
}

Sequencer.reset();

class Foo {
    a = 1

	static staticA = 111

	foo(){}

	constructor() {
		this.aa = Sequencer.next()
	}
}

class Bar extends Foo {
	b = 2
	
	static staticB = 222

	bar(){}

	constructor() {
		super()
		this.bb = Sequencer.next()
	}
}

class Qux {
	qux(){}

	constructor() {
		this.dd = Sequencer.next()
	}
}

class Baz extends Mixins([Bar, Qux]) {
	c = 3

	static staticC = 333

	baz(){}

	constructor() {
		super()
		this.cc = Sequencer.next()
		
		// access own and inherited properties, plus own and inherited static properties
		this.ee = this.c + this.b + this.a + Baz.staticC + Baz.staticB + Baz.staticA;
	}
}

beforeEach(()=> {
    Sequencer.reset();
});

test('instance properties', t => {
	let baz = new Baz()

	assert.equal(baz.a, 1)
	assert.equal(baz.b, 2)
	assert.equal(baz.c, 3)
})

test('prototype methods', t => {
	let baz = new Baz()

	assert.equal(typeof baz.foo, 'function')
	assert.equal(typeof baz.bar, 'function')
	assert.equal(typeof baz.baz, 'function')
	assert.equal(typeof baz.qux, 'function')
})

test('constructors', t => {
	let baz = new Baz()

	assert.equal(baz.aa, 0)
	assert.equal(baz.bb, 1)
	assert.equal(baz.dd, 2)
	assert.equal(baz.cc, 3)

	let baz2 = new Baz()

	assert.equal(baz2.aa, 4)
	assert.equal(baz2.bb, 5)
	assert.equal(baz2.dd, 6)
	assert.equal(baz2.cc, 7)

	assert.equal(baz.ee, 1 + 2 + 3 + 111 + 222 + 333)
})

test('static properties', t => {
	assert.equal(Baz.staticA, 111)
	assert.equal(Baz.staticB, 222)
	assert.equal(Baz.staticC, 333)
})
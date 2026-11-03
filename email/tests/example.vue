<template>
	<div>Hello {{ name }}, you are {{ age }} years old</div>
</template>
<script>
import { dependency } from './dependency.js'

export default async function(event) {
	return {
		to: 'test@test.com',
		subject: 'i am the subject',
		data: {
			name: 'Mr Test',
			age: event.age,
			dependency
		}
	}
}
</script>
<template>
	<template v-if="mode == 'html'">
		<div>Hello <strong>{{ data.name }}</strong>, you are {{ data.age }} years old</div>
	</template>
	<template v-else>
		Hello {{ data.name }}, you are {{ data.age }} years old
	</template>
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
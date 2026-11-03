<template>
	<template v-if="mode == 'html'">
		<h1>Wrapper header</h1>
		<template v-html="body" />
		<h1>Wrapper footer</h1>
	</template>
	<template v-else>
		Wrapper header: {{ data.wrapper }}
		{{ body }}
		Wrapper footer {{ data.age }}
	</template>
</template>
<script>
import { dependency } from './dependency.js'

export default async function() {
	return {
		replyTos: ['test@test.com'],
		source: 'test@test.com',
		data: {
			wrapper: 'wrappy',
			dependency
		}
	}
}
</script>
<template>
	<div>Hello {{ name }}</div>
</template>
<script>
import { dependency } from './dependency.js'

export default async function(event) {
	return {
		to: 'test@test.com',
		data: {
			name: 'Mr Test',
			dependency
		}
	}
}
</script>
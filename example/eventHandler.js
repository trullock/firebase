import { registerEventHandler } from '../src/cqrs/eventHandling.js'
import { log } from '../src/logging/logger.js'

registerEventHandler('myClassCreated', event => {
	log('Handling myClassCreated', event);
})
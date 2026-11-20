/**
 * Stands in for firebase-admin's Functions, given to configureTasks: records queued tasks instead of dispatching them.
 * The harness (testing) runs them after each command and schedule. Call reset() between tests.
 */
const functions = {
	queued: [],

	taskQueue(name)
	{
		return {
			enqueue: async (data, opts) => {
				// task payloads are sent as JSON, so anything that doesn't survive that would be lost in production too
				this.queued.push({ queue: name, data: JSON.parse(JSON.stringify(data)), opts });
			}
		};
	},

	reset()
	{
		this.queued = [];
	}
};

export default functions;

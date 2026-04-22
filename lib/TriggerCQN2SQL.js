/**
 * Custom CQN2SQL implementation for trigger and procedure contexts
 *
 * Overrides the `val` method to support `{ val: '...', literal: 'sql' }`
 * for embedding raw SQL expressions (e.g., trigger row references) without quoting.
 */

function createTriggerCQN2SQL(BaseCQN2SQL) {
	return class TriggerCQN2SQL extends BaseCQN2SQL {
		val(x) {
			if (x?.literal === 'sql') return x.val;
			return super.val(x);
		}
	};
}

module.exports = { createTriggerCQN2SQL };

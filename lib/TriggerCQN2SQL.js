/**
 * Custom CQN2SQL implementation that handles trigger-specific columns
 * without wrapping them in quotes.
 *
 * Overrides the `val` method to handle trigger row references:
 * - HANA (statement-level): nt.column, ot.column (transition table aliases)
 * - Postgres: OLD.column, NEW.column, rec.column
 * - SQLite: old.column, new.column
 */

function createTriggerCQN2SQL(BaseCQN2SQL) {
	return class TriggerCQN2SQL extends BaseCQN2SQL {
		val(x) {
			// Check if this is a trigger row reference
			if (x && x.val && typeof x.val === 'string') {
				const triggerRefPattern = /^:?(?:old|new|OLD|NEW|rec|nt|ot)\.\w+$/;
				if (triggerRefPattern.test(x.val)) {
					return x.val;
				}
			}

			// Fall back to the base implementation for all other cases
			return super.val(x);
		}
	};
}

module.exports = { createTriggerCQN2SQL };

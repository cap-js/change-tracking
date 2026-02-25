/**
 * Custom CQN2SQL implementation that handles trigger-specific columns (:old.*, :new.*)
 * without wrapping them in quotes.
 */

function createTriggerCQN2SQL(BaseCQN2SQL) {
	return class TriggerCQN2SQL extends BaseCQN2SQL {
		/**
		 * Override the val method to handle trigger row references.
		 * Supports multiple patterns:
		 * - HANA: :old.column, :new.column (with colon, lowercase)
		 * - Postgres: OLD.column, NEW.column, rec.column (no colon, uppercase)
		 * - SQLite: old.column, new.column (no colon, lowercase)
		 */
		val(x) {
			// Check if this is a trigger row reference
			if (x && x.val && typeof x.val === 'string') {
				const triggerRefPattern = /^:?(?:old|new|OLD|NEW|rec)\.\w+$/;
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

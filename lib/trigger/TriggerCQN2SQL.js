/**
 * Custom CQN2SQL implementation that handles trigger-specific columns (:old.*, :new.*)
 * without wrapping them in quotes.
 *
 * Overrides the `val` method to handle trigger row references:
 * - HANA: :old.column, :new.column
 * - Postgres: OLD.column, NEW.column, rec.column
 * - SQLite: old.column, new.column
 *
 * Also provides a dummy table definition for SAP_CHANGELOG_CHANGE_TRACKING_DUMMY
 * to allow generating WHERE conditions without model validation.
 */

function createTriggerCQN2SQL(BaseCQN2SQL) {
	return class TriggerCQN2SQL extends BaseCQN2SQL {
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

		from(q) {
			// Check if this is our dummy table
			if (q && q.ref && q.ref[0] === 'SAP_CHANGELOG_CHANGE_TRACKING_DUMMY') {
				// Return a minimal FROM clause without validation
				return 'SAP_CHANGELOG_CHANGE_TRACKING_DUMMY';
			}

			// Fall back to the base implementation
			return super.from(q);
		}
	};
}

module.exports = { createTriggerCQN2SQL };

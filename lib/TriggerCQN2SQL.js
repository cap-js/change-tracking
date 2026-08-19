/**
 * Custom CQN2SQL implementation for trigger and procedure contexts
 *
 * Overrides the `val` method to support `{ val: '...', literal: 'sql' }`
 * for embedding raw SQL expressions (e.g., trigger row references) without quoting.
 *
 * Optionally extends `ReservedWords` with additional dialect-specific keywords used by the H2 backend where the base (SQLite-inherited) reserved-word set is too permissive (identifiers like `value`, `key`, ... are legal in SQLite but reserved in H2, so column aliases such as `SELECT … AS value` are rejected unless the compiler emits them quoted)
 */

function createTriggerCQN2SQL(BaseCQN2SQL, extraReservedWords) {
  class TriggerCQN2SQL extends BaseCQN2SQL {
    val(x) {
      if (x?.literal === 'sql') return x.val;
      return super.val(x);
    }
  }
  if (extraReservedWords?.length) {
    // Own copy so we don't mutate the parent's shared table.
    const merged = { ...BaseCQN2SQL.ReservedWords };
    for (const w of extraReservedWords) {
      const upper = w.toUpperCase();
      const lower = w.toLowerCase();
      const cap = upper[0] + lower.slice(1);
      merged[upper] = 1;
      merged[lower] = 1;
      merged[cap] = 1;
    }
    TriggerCQN2SQL.ReservedWords = merged;
  }
  return TriggerCQN2SQL;
}

module.exports = { createTriggerCQN2SQL };

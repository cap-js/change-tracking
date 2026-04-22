/**
 * Shared utility for translating CDS expression annotations (xpr) to SQL
 * in trigger context. Used by all DB backends (SQLite, HANA, Postgres).
 */
function buildExpressionSQL(xpr, entityName, refRow, model, CQN2SQL, toSQL, formatRef) {
	const entity = model.definitions[entityName];
	const fmt = formatRef ?? ((r, c) => `${r}.${c}`);

	const renderer = new CQN2SQL({ model });
	renderer.ref = function ({ ref }) {
		if (ref.length === 1) return fmt(refRow, ref[0]);

		// Multi-segment ref: association path -> scalar subquery against target
		const assocName = ref[0];
		const fieldPath = ref.slice(1).join('_');
		const assocElement = entity?.elements?.[assocName];
		if (assocElement?.target) {
			const where = _buildAssocWhere(assocElement, assocName, refRow, fmt);
			const query = SELECT.from(assocElement.target).columns(fieldPath).where(where);
			return `(${toSQL(query, model)})`;
		}
		// Fallback: flattened field reference
		return fmt(refRow, ref.join('_'));
	};

	return renderer.xpr({ xpr });
}

/**
 * Builds a CQN WHERE object for looking up an association target
 * using trigger-row FK values.
 */
function _buildAssocWhere(assocElement, assocName, refRow, fmt) {
	const where = {};
	if (assocElement.keys) {
		for (const k of assocElement.keys) {
			const fkName = k.ref.join('_');
			where[fkName] = { val: fmt(refRow, `${assocName}_${fkName}`), literal: 'sql' };
		}
	} else if (assocElement.on) {
		for (let i = 0; i < assocElement.on.length; i++) {
			const cond = assocElement.on[i];
			if (cond.ref && cond.ref.length === 2 && cond.ref[0] === assocName) {
				const targetKey = cond.ref[1];
				if (i + 1 < assocElement.on.length && assocElement.on[i + 1] === '=') {
					const fkRef = assocElement.on[i + 2];
					if (fkRef?.ref) {
						const fkField = fkRef.ref[fkRef.ref.length - 1];
						where[targetKey] = { val: fmt(refRow, fkField), literal: 'sql' };
					}
				}
			}
		}
	}
	return where;
}

module.exports = { buildExpressionSQL };

/**
 * Shared utility for translating CDS expression annotations (xpr) to SQL
 * in trigger context. Used by all DB backends (SQLite, HANA, Postgres).
 *
 * Classifies the expression and dispatches to the appropriate strategy:
 * - Case A (local-only): Inline rendering using trigger row refs
 * - Case B (single association, no local fields): Subselect from target entity
 * - Case C (mixed local + association, or multiple associations): Inline with scalar subselects per association ref
 */
function buildExpressionSQL(xpr, entity, refRow, model, toSQL, colRef, CQN2SQL) {
	const { hasLocal, assocNames } = _classifyExpression(xpr);

	// Case B: Single association, no local fields
	// Build a subselect from the association target entity
	let result;
	if (!hasLocal && assocNames.length === 1) {
		result = _buildSingleAssocExpression(xpr, entity, assocNames[0], refRow, model, toSQL, colRef);
	}

	// Case A (local-only) and Case C (mixed): Use inline CQN2SQL rendering
	result = _buildInlineExpression(xpr, entity, refRow, model, toSQL, colRef, CQN2SQL);
	return result;
}

/**
 * Classifies an xpr by analyzing its ref tokens.
 * @returns {{ hasLocal: boolean, assocNames: string[] }}
 */
function _classifyExpression(xpr) {
	let hasLocal = false;
	const assocSet = new Set();

	for (const token of xpr) {
		if (token?.ref) {
			if (token.ref.length === 1) {
				hasLocal = true;
			} else {
				assocSet.add(token.ref[0]);
			}
		}
		// Recurse into nested xpr (e.g., ternary/CASE expressions)
		if (token?.xpr) {
			const nested = _classifyExpression(token.xpr);
			if (nested.hasLocal) hasLocal = true;
			for (const a of nested.assocNames) assocSet.add(a);
		}
	}

	return { hasLocal, assocNames: [...assocSet] };
}

/**
 * Case B: Expression references only fields from a single association target.
 * Builds a SELECT from the target entity with the expression (refs stripped of assoc prefix)
 * and WHERE clause using FK fields from the trigger row.
 */
function _buildSingleAssocExpression(xpr, entity, assocName, refRow, model, toSQL, colRef) {
	const assocElement = entity.elements[assocName];
	const target = assocElement.target;

	// Strip the association prefix from all refs in the xpr
	const strippedXpr = _stripAssocPrefix(xpr, assocName);

	// Build WHERE clause using FK fields from trigger row
	const where = _buildAssocWhere(assocElement, assocName, refRow, colRef);

	const query = SELECT.one.from(target).columns({ xpr: strippedXpr, as: 'value' }).where(where);
	return toSQL(query, model);
}

/**
 * Cases A & C: Use CQN2SQL with a custom ref handler to render the expression inline.
 * - Single-segment refs (local fields) -> trigger row references
 * - Multi-segment refs (association paths) -> scalar subselects from the target entity
 */
function _buildInlineExpression(xpr, entity, refRow, model, toSQL, colRef, CQN2SQL) {
	const renderer = new CQN2SQL({ model });
	renderer.ref = function ({ ref }) {
		if (ref.length === 1) {
			// Local field: inline trigger row reference
			return colRef(refRow, ref[0]);
		}

		// Multi-segment ref: association path -> scalar subquery against the target
		const assocName = ref[0];
		const assocElement = entity?.elements?.[assocName];
		if (assocElement?.target) {
			// Build subselect from the target entity using remaining ref segments as column
			// cqn4sql will resolve nested association paths (e.g., customer.address.city)
			const remainingRef = ref.slice(1);
			const where = _buildAssocWhere(assocElement, assocName, refRow, colRef);
			const query = SELECT.one.from(assocElement.target).columns({ ref: remainingRef, as: 'value' }).where(where);
			return `(${toSQL(query, model)})`;
		}

		// Fallback: flattened field reference
		return colRef(refRow, ref.join('_'));
	};

	return renderer.xpr({ xpr });
}

/**
 * Strips the association prefix from all refs in an xpr array.
 * e.g., { ref: ['status', 'code'] } -> { ref: ['code'] }
 */
function _stripAssocPrefix(xpr, assocName) {
	return xpr.map((token) => {
		if (token?.ref && token.ref.length > 1 && token.ref[0] === assocName) {
			return { ...token, ref: token.ref.slice(1) };
		}
		if (token?.xpr) {
			return { ...token, xpr: _stripAssocPrefix(token.xpr, assocName) };
		}
		return token;
	});
}

/**
 * Builds a CQN WHERE object for looking up an association target
 * using trigger-row FK values. Handles both managed and unmanaged associations.
 */
function _buildAssocWhere(column, assocName, refRow, colRef) {
	const where = {};
	if (column.keys) {
		// Managed association: FK fields are named assocName_keyRef
		for (const k of column.keys) {
			const fkName = k.ref.join('_');
			where[fkName] = { val: colRef(refRow, `${assocName}_${fkName}`), literal: 'sql' };
		}
	} else if (column.on) {
		// Unmanaged association: parse on-condition for FK mapping
		for (let i = 0; i < column.on.length; i++) {
			const cond = column.on[i];
			if (cond.ref && cond.ref.length === 2 && cond.ref[0] === assocName) {
				const targetKey = cond.ref[1];
				if (i + 1 < column.on.length && column.on[i + 1] === '=') {
					const fkRef = column.on[i + 2];
					if (fkRef?.ref) {
						const fkField = fkRef.ref[fkRef.ref.length - 1];
						where[targetKey] = { val: colRef(refRow, fkField), literal: 'sql' };
					}
				}
			}
		}
	}
	return where;
}

module.exports = { buildExpressionSQL };

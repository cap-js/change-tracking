import cds from '@sap/cds/eslint.config.mjs';
export default [
	...cds,
	{
		files: ['tests/**/*.test.js'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: "MemberExpression[property.name='only']",
					message: '.only is not allowed in tests.'
				}
			]
		}
	}
];

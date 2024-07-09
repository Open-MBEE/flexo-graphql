module.exports = {
	extends: '@blake.regalia/eslint-config-elite',
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		tsconfigRootDir: __dirname,
		project: 'tsconfig.json',
	},
	rules: {
		'@typescript-eslint/no-unsafe-argument': ['off'],
		'@typescript-eslint/no-redundant-type-constituents': ['off'],
	},
};

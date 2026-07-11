import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default [
  js.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-unreachable': 'warn',
      'no-unused-expressions': 'warn',

      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-identical-expressions': 'warn',
      'sonarjs/no-identical-conditions': 'warn',

      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-commented-code': 'off',
      'sonarjs/todo-tag': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/no-nested-functions': 'off',
      'sonarjs/no-nested-conditional': 'off',
      'sonarjs/different-types-comparison': 'off',
      'sonarjs/no-dead-store': 'off',
      'sonarjs/no-ignored-exceptions': 'off',
      'sonarjs/updated-loop-counter': 'off',
    },
  },
  prettier,
  { ignores: ['dist/**', 'node_modules/**'] },
];

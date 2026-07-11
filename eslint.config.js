import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
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
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js'],
        },
      },
    },
    rules: {
      // --- Неиспользуемые переменные / аргументы / импорты ---
      'no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // --- Мёртвый / бессмысленный код (core) ---
      'no-unreachable': 'warn',
      'no-unused-expressions': 'warn',
      'no-useless-return': 'warn',
      'no-useless-concat': 'warn',
      'no-useless-rename': 'warn',
      'no-self-compare': 'warn',
      'no-unneeded-ternary': 'warn',

      // --- Дублирование кода (sonarjs) ---
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-identical-expressions': 'warn',
      'sonarjs/no-identical-conditions': 'warn',
      'sonarjs/no-all-duplicated-branches': 'warn',
      'sonarjs/no-duplicated-branches': 'warn',

      // --- Импорты ---
      'import/no-unresolved': [
        'error',
        { ignore: ['^@core/', '^@engine/', '^@game/', '^@client/', '^@combat/', '^@entity/', '^@level/', '^@network/', '^@server/'] },
      ],
      'import/no-duplicates': 'warn',
      'import/no-unused-modules': [
        'warn',
        {
          unusedExports: true,
          missingExports: false,
          ignoreExports: [
            'src/index.js',
            'src/core/index.js',
            'src/engine/index.js',
            'src/client/**',
            'src/combat/**',
            'src/entity/**',
            'src/level/**',
            'src/network/**',
            'src/server/**',
            'src/game/global.js',
            'src/game/polyfill.js',
            'src/game/launcher.js',
            'eslint.config.js',
            'vite.config.*',
          ],
        },
      ],
      'import/order': [
        'warn',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // --- Шумные «качественные» правила sonarjs выключены: формат и стиль
      //     остаются за Prettier, а здесь ловим только реальные проблемы. ---
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-commented-code': 'off',
      'sonarjs/todo-tag': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/no-nested-functions': 'off',
      'sonarjs/no-nested-conditional': 'off',
      'sonarjs/different-types-comparison': 'off',
      'sonarjs/no-dead-store': 'off',
      // Пустые catch — намеренный best-effort (sessionStorage/destroy и т.п.).
      'sonarjs/no-ignored-exceptions': 'off',
      // Правка счётчика цикла осознанно используется в парсере текста.
      'sonarjs/updated-loop-counter': 'off',
    },
  },
  // Prettier владеет форматированием: отключаем все конфликтующие стилевые правила.
  prettier,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];

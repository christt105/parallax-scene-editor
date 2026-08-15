import js from '@eslint/js';
import globals from 'globals';

// Default recommended rules only, split by where each part of the tree runs:
// browser globals for src/, Node for the tests.
export default [
  { ignores: ['demo/', 'tools/', '.claude/'] },

  js.configs.recommended,

  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },

  {
    files: ['test/**/*.mjs', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  {
    // Runs under Node, but page.evaluate() callbacks run in the browser.
    files: ['e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
